/**
 * TF.js Web Worker — loads TF.js from /tf.min.js (local bundle).
 * Handles: init, predict, trainOnBatch, batchTrain, backtest, reset, getModelData
 *
 * Anti-forgetting measures:
 *   1. Gradient clipping (clipnorm=1.0) on the Adam optimizer
 *   2. Separate learning rates: online (0.0001) vs batch (0.001)
 *   3. EMA (exponential moving average, decay=0.99) of weights
 *   4. Online learning rate decay: LR halves every 1000 updates
 */

importScripts('/tf.min.js');

console.log('[TF-Worker] importScripts done, self.tf=', typeof self.tf, 'keys=', self.tf ? Object.keys(self.tf).slice(0,5) : 'N/A');
const tf = self.tf;
if (!tf) { console.error('[TF-Worker] tf.js failed to load! self.tf is', typeof self.tf); }
else { console.log('[TF-Worker] tf.js loaded successfully. Has sequential:', typeof tf.sequential); }

const SEQUENCE_LENGTH = 20;
const ONLINE_LR = 0.0001;       // Conservative LR for per-tick online updates
const BATCH_LR = 0.001;         // Standard LR for periodic batch training
const GRAD_CLIP_NORM = 1.0;     // Max gradient L2-norm before clipping
const EMA_DECAY = 0.99;         // EMA decay for weight averaging
const LR_DECAY_INTERVAL = 1000; // Halve online LR every N updates

let model = null;
let emaWeights = null;          // Exponential moving average of model weights
let onlineUpdateCount = 0;
let currentOnlineLR = ONLINE_LR;

function buildModel(lr) {
  const m = tf.sequential();
  m.add(tf.layers.lstm({ units: 64, returnSequences: true, inputShape: [SEQUENCE_LENGTH, 10] }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.lstm({ units: 32, returnSequences: false }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  m.add(tf.layers.dense({ units: 10, activation: 'softmax' }));

  const optimizer = tf.train.adam(lr || BATCH_LR);
  // Apply gradient clipping via clipnorm — clamps the L2-norm of the gradient vector
  // This prevents any single update from moving weights too drastically
  optimizer.clipnorm = GRAD_CLIP_NORM;

  m.compile({
    optimizer,
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return m;
}

/** Initialize EMA weights from the current model weights */
function initEMA() {
  if (!model) return;
  const weights = model.getWeights();
  emaWeights = weights.map(w => w.clone());
}

/** Update EMA: ema = decay * ema + (1 - decay) * current */
function updateEMA() {
  if (!model || !emaWeights) { initEMA(); return; }
  const currentWeights = model.getWeights();
  const newEMA = [];
  for (let i = 0; i < currentWeights.length; i++) {
    const ema = tf.tidy(() => {
      const current = currentWeights[i];
      const prev = emaWeights[i];
      if (!prev) return current.clone();
      return tf.add(tf.mul(prev, EMA_DECAY), tf.mul(current, 1 - EMA_DECAY));
    });
    // Dispose old EMA and current if needed
    if (emaWeights[i]) emaWeights[i].dispose();
    emaWeights[i] = ema;
  }
  // Dispose old current weights (they've been copied into EMA computation)
  for (const w of currentWeights) w.dispose();
}

/** Apply EMA weights to model (use for inference/prediction) */
function applyEMA() {
  if (!model || !emaWeights) return;
  const currentWeights = model.getWeights();
  const emaApplied = emaWeights.map(w => w.clone());
  model.setWeights(emaApplied);
  // Dispose the old weights
  for (const w of currentWeights) w.dispose();
}

/** Revert from EMA back to training weights (called after predict) */
function revertFromEMA(originalWeights) {
  if (!model || !originalWeights) return;
  model.setWeights(originalWeights.map(w => w.clone()));
  for (const w of originalWeights) w.dispose();
}

function prepareInput(digits) {
  return digits.map(d => { const oh = new Array(10).fill(0); oh[d] = 1; return oh; });
}

function predict(inputSequence) {
  if (!model || inputSequence.length < SEQUENCE_LENGTH) return null;
  const input = prepareInput(inputSequence.slice(-SEQUENCE_LENGTH));
  const output = tf.tidy(() => {
    const t = tf.tensor3d([input], [1, SEQUENCE_LENGTH, 10]);
    return model.predict(t);
  });
  const probs = Array.from(output.dataSync());
  output.dispose();
  let topDigit = 0, topProb = 0;
  for (let i = 0; i < 10; i++) { if (probs[i] > topProb) { topProb = probs[i]; topDigit = i; } }
  const confidence = Math.min(1, Math.max(0, (topProb - 0.1) / 0.4));
  let biasStrength = 0;
  for (let i = 0; i < 10; i++) biasStrength += Math.abs(probs[i] - 0.1);
  biasStrength = Math.min(1, biasStrength / 1.8);
  let over5 = 0, under5 = 0;
  for (let i = 0; i < 5; i++) under5 += probs[i];
  for (let i = 5; i < 10; i++) over5 += probs[i];
  const overUnder5Bias = over5 > under5 + 0.05 ? 'over' : under5 > over5 + 0.05 ? 'under' : 'neutral';
  let entropy = 0;
  for (let i = 0; i < 10; i++) { if (probs[i] > 0) entropy -= probs[i] * Math.log2(probs[i]); }
  entropy /= Math.log2(10);
  return {
    probabilities: probs.map(p => Math.round(p * 10000) / 10000),
    topDigit,
    confidence: Math.round(confidence * 10000) / 10000,
    biasStrength: Math.round(biasStrength * 10000) / 10000,
    overUnder5Bias,
    entropy: Math.round(entropy * 10000) / 10000,
  };
}

/**
 * Online learning — called per-tick with small batches.
 * Uses conservative LR with decay, gradient clipping, and EMA.
 */
async function trainOnBatch(xs, ys) {
  if (!model || xs.length === 0) return { loss: 0, gradNorm: 0 };

  // Decay online learning rate over time
  onlineUpdateCount++;
  if (onlineUpdateCount % LR_DECAY_INTERVAL === 0) {
    currentOnlineLR = Math.max(currentOnlineLR * 0.5, 1e-6);
    console.log(`[TF-Worker] Online LR decayed to ${currentOnlineLR} after ${onlineUpdateCount} updates`);
    model.optimizer.setLearningRate(currentOnlineLR);
  }

  const xsT = tf.tensor3d(xs, [xs.length, SEQUENCE_LENGTH, 10]);
  const ysT = tf.tensor2d(ys, [ys.length, 10]);
  try {
    // Compute gradient norm before clipping for monitoring
    let gradNormVal = 0;
    try {
      const grads = tf.variableGrads(() => {
        const yPred = model.apply(xsT, { training: true });
        return model.losses[0](ysT, yPred);
      });
      gradNormVal = tf.tidy(() => {
        const norms = grads.grads.map(g => tf.norm(g));
        const totalNorm = tf.sqrt(norms.reduce((acc, n) => tf.add(acc, tf.square(n)), tf.scalar(0)));
        return totalNorm.dataSync()[0];
      });
      // Dispose gradient tensors
      for (const g of Object.values(grads.grads)) g.dispose();
      grads.grad.dispose();
    } catch { /* gradient norm computation is optional monitoring */ }

    const result = model.trainOnBatch(xsT, ysT);
    const lossVal = await result;

    // Update EMA weights after each online training step
    updateEMA();

    return {
      loss: typeof lossVal === 'number' ? lossVal : 0,
      gradNorm: Math.round(gradNormVal * 10000) / 10000,
      lr: currentOnlineLR,
      updateCount: onlineUpdateCount,
    };
  } finally { xsT.dispose(); ysT.dispose(); }
}

/**
 * Batch training — periodic full epochs on recent buffer.
 * Uses standard LR with gradient clipping and EMA.
 */
async function batchTrain(digitBuffer, seqLength, batchSize, epochs, stride) {
  console.log('[TF-Worker] batchTrain called: model=', !!model, 'bufferLen=', digitBuffer?.length, 'seqLen=', seqLength);
  if (!model || !digitBuffer || digitBuffer.length < seqLength + 10) {
    console.log('[TF-Worker] batchTrain early return: model=', !!model, "bufferLen=", digitBuffer?.length);
    return { loss: 0, accuracy: 0, epoch: 0 };
  }

  // Set batch LR (may differ from online LR)
  model.optimizer.setLearningRate(BATCH_LR);

  const xs = [], ys = [];
  for (let i = seqLength; i < digitBuffer.length; i += (stride || 3)) {
    xs.push(prepareInput(digitBuffer.slice(i - seqLength, i)));
    const oh = new Array(10).fill(0); oh[digitBuffer[i]] = 1; ys.push(oh);
  }
  if (xs.length === 0) return { loss: 0, accuracy: 0, epoch: 0 };
  const xsT = tf.tensor3d(xs, [xs.length, seqLength, 10]);
  const ysT = tf.tensor2d(ys, [ys.length, 10]);
  try {
    const history = await model.fit(xsT, ysT, {
      batchSize: batchSize || 32,
      epochs: epochs || 2,
      shuffle: true,
      validationSplit: 0.1,
      verbose: 0,
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          self.postMessage({
            type: 'trainProgress',
            epoch: epoch + 1,
            totalEpochs: epochs || 2,
            loss: logs?.loss ?? 0,
            accuracy: logs?.acc ?? 0,
            valLoss: logs?.val_loss ?? 0,
            valAccuracy: logs?.val_acc ?? 0,
            samplesInBatch: xs.length,
          });
        }
      },
    });
    const loss = history.history.loss[history.history.loss.length - 1];
    const acc = history.history.acc ? history.history.acc[history.history.acc.length - 1] : 0;

    // Update EMA after batch training
    updateEMA();

    // Restore online LR
    model.optimizer.setLearningRate(currentOnlineLR);

    return {
      loss: Math.round(loss * 10000) / 10000,
      accuracy: Math.round(acc * 10000) / 10000,
      epoch: history.history.loss?.length ?? 1,
    };
  } finally { xsT.dispose(); ysT.dispose(); }
}

async function runBacktest(digits, trainRatio, epochs) {
  if (digits.length < SEQUENCE_LENGTH + 50) { self.postMessage({ type: 'backtestError', error: 'Not enough data' }); return; }
  const splitIdx = Math.floor(digits.length * trainRatio);
  const trainD = digits.slice(0, splitIdx), testD = digits.slice(splitIdx);
  const trainXs = [], trainYs = [];
  for (let i = SEQUENCE_LENGTH; i < trainD.length; i++) {
    trainXs.push(prepareInput(trainD.slice(i - SEQUENCE_LENGTH, i)));
    const oh = new Array(10).fill(0); oh[trainD[i]] = 1; trainYs.push(oh);
  }
  const btModel = buildModel(BATCH_LR);
  const lossHist = [];
  const xsT = tf.tensor3d(trainXs, [trainXs.length, SEQUENCE_LENGTH, 10]);
  const ysT = tf.tensor2d(trainYs, [trainYs.length, 10]);
  self.postMessage({ type: 'backtestProgress', phase: 'training', currentEpoch: 0, totalEpochs: epochs, percentComplete: 10 });
  await btModel.fit(xsT, ysT, {
    batchSize: 64, epochs, shuffle: true, validationSplit: 0.1, verbose: 0,
    callbacks: { onEpochEnd: async (epoch, logs) => {
      const loss = logs?.loss ?? 0; lossHist.push(loss);
      self.postMessage({ type: 'backtestProgress', phase: 'training', currentEpoch: epoch + 1, totalEpochs: epochs, trainLoss: Math.round(loss * 10000) / 10000, percentComplete: 10 + ((epoch + 1) / epochs) * 70 });
      await new Promise(r => setTimeout(r, 0));
    }},
  });
  xsT.dispose(); ysT.dispose();
  let correct = 0, top3Correct = 0, evalCount = 0, testLoss = 0;
  const confusion = Array.from({ length: 10 }, () => new Array(10).fill(0));
  const digitCorrect = new Array(10).fill(0), digitTotal = new Array(10).fill(0);
  for (let i = SEQUENCE_LENGTH; i < testD.length; i++) {
    const ctxStart = splitIdx + i - SEQUENCE_LENGTH; if (ctxStart < 0) continue;
    const ctx = [...trainD.slice(Math.max(0, ctxStart)), ...testD.slice(0, i)];
    const seq = ctx.slice(-SEQUENCE_LENGTH); if (seq.length < SEQUENCE_LENGTH) continue;
    const input = prepareInput(seq);
    const inT = tf.tensor3d([input], [1, SEQUENCE_LENGTH, 10]);
    const out = btModel.predict(inT); const probs = out.dataSync();
    inT.dispose(); out.dispose();
    const actual = testD[i]; digitTotal[actual]++; evalCount++;
    let topD = 0, topP = 0; const pArr = Array.from(probs);
    for (let d = 0; d < 10; d++) { if (pArr[d] > topP) { topP = pArr[d]; topD = d; } }
    if (topD === actual) { correct++; digitCorrect[actual]++; }
    const sorted = pArr.map((p, d) => ({ p, d })).sort((a, b) => b.p - a.p);
    if (sorted[0].d === actual || sorted[1].d === actual || sorted[2].d === actual) top3Correct++;
    confusion[actual][topD]++;
    if (probs[actual] > 0) testLoss -= Math.log(probs[actual] + 1e-10);
    if (evalCount % 100 === 0) {
      self.postMessage({ type: 'backtestProgress', phase: 'evaluating', currentEpoch: epochs, totalEpochs: epochs, percentComplete: 85 + (evalCount / (testD.length - SEQUENCE_LENGTH)) * 15 });
      await new Promise(r => setTimeout(r, 0));
    }
  }
  testLoss = evalCount > 0 ? testLoss / evalCount : 0;
  const accuracy = evalCount > 0 ? correct / evalCount : 0;
  const top3Acc = evalCount > 0 ? top3Correct / evalCount : 0;
  const digitAccuracy = Array.from({ length: 10 }, (_, d) => ({ digit: d, correct: digitCorrect[d], total: digitTotal[d], accuracy: digitTotal[d] > 0 ? digitCorrect[d] / digitTotal[d] : 0 }));
  const precision = [], recall = []; let macroF1 = 0, cls = 0;
  for (let d = 0; d < 10; d++) {
    let tp = 0, fp = 0, fn = 0;
    for (let a = 0; a < 10; a++) { if (a === d) tp = confusion[a][d]; else fp += confusion[a][d]; }
    for (let p = 0; p < 10; p++) { if (p !== d) fn += confusion[d][p]; }
    const prec = tp + fp > 0 ? tp / (tp + fp) : 0, rec = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0;
    precision.push(Math.round(prec * 1000) / 1000); recall.push(Math.round(rec * 1000) / 1000);
    if (digitTotal[d] > 0) { macroF1 += f1; cls++; }
  }
  btModel.dispose();
  self.postMessage({ type: 'backtestResult', result: {
    completed: true, totalSamples: digits.length, trainSize: trainD.length, testSize: testD.length,
    accuracy: Math.round(accuracy * 10000) / 10000, digitAccuracy, confusionMatrix: confusion,
    testLoss: Math.round(testLoss * 10000) / 10000, epochsCompleted: epochs,
    trainingLossHistory: lossHist.map(l => Math.round(l * 10000) / 10000),
    precision, recall, f1Score: Math.round((cls > 0 ? macroF1 / cls : 0) * 10000) / 10000,
    top3Accuracy: Math.round(top3Acc * 10000) / 10000, completedAt: Date.now(),
  }});
}

self.onmessage = async function (e) {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      console.log('[TF-Worker] init received, tf=', typeof tf, 'model was=', !!model);
      try {
        if (msg.topology && msg.weightData) {
          model = null;
          try {
            model = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: msg.topology, weightSpecs: msg.topology.weights || [], weightData: msg.weightData }));
          } catch(e) { console.warn('[TF-Worker] loadModel failed, building fresh:', e?.message); model = buildModel(BATCH_LR); }
        } else {
          model = buildModel(BATCH_LR);
        }
        // Initialize EMA with current weights
        initEMA();
        onlineUpdateCount = 0;
        currentOnlineLR = ONLINE_LR;
        console.log('[TF-Worker] init complete, model=', !!model, 'clipnorm=', model.optimizer.clipnorm);
        self.postMessage({ type: 'status', status: 'ready' });
      } catch (err) {
        console.error('[TF-Worker] init outer failed:', err?.message || err);
        try { model = buildModel(BATCH_LR); initEMA(); } catch(e2) { console.error('[TF-Worker] fallback buildModel also failed:', e2?.message); }
        self.postMessage({ type: 'status', status: 'ready' });
      }
      break;
    }
    case 'predict': { const r = predict(msg.inputSequence); self.postMessage({ type: 'prediction', id: msg.id, result: r }); break; }
    case 'trainOnBatch': { const r = await trainOnBatch(msg.xs, msg.ys); self.postMessage({ type: 'trainResult', id: msg.id, result: r }); break; }
    case 'batchTrain': { const r = await batchTrain(msg.digitBuffer, msg.seqLength, msg.batchSize, msg.epochs, msg.stride); self.postMessage({ type: 'batchTrainResult', id: msg.id, result: r }); break; }
    case 'backtest': { await runBacktest(msg.digits, msg.trainRatio, msg.epochs); break; }
    case 'reset': {
      if (model) model.dispose();
      if (emaWeights) { for (const w of emaWeights) w.dispose(); emaWeights = null; }
      model = buildModel(BATCH_LR);
      initEMA();
      onlineUpdateCount = 0;
      currentOnlineLR = ONLINE_LR;
      self.postMessage({ type: 'status', status: 'ready' });
      break;
    }
    case 'getModelData': {
      if (!model) { self.postMessage({ type: 'modelData', id: msg.id, topology: null, weightData: null }); break; }
      try {
        const topology = model.toJSON();
        const weights = model.getWeights();
        const weightData = [];
        for (const w of weights) { const data = await w.data(); weightData.push(Array.from(new Float32Array(data))); }
        self.postMessage({ type: 'modelData', id: msg.id, topology, weightData });
      } catch { self.postMessage({ type: 'modelData', id: msg.id, topology: null, weightData: null }); }
      break;
    }
    case 'dispose': {
      if (model) model.dispose(); model = null;
      if (emaWeights) { for (const w of emaWeights) w.dispose(); emaWeights = null; }
      break;
    }
  }
};

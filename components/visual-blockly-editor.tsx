"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconPlayerPlay, IconPlayerStop, IconPlayerPause,
  IconClipboard, IconCheck, IconDeviceFloppy, IconFolderOpen,
  IconTrash, IconDownload, IconUpload, IconPlus, IconX, IconChartLine,
} from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { BotSandbox, type BotStatus, type BotLogEntry, type ProposalData, type ContractData, type BotTradingAdapter } from "../lib/bot-sandbox";
const BacktestRunner = dynamic(() => import("./backtest-runner"), { ssr: false });
import {
  getStrategies, saveStrategy, updateStrategy, deleteStrategy,
  duplicateStrategy, exportStrategyXml, importStrategyXml,
  type SavedStrategy,
} from "../lib/strategy-storage";

const BlocklyWorkspace = dynamic(() => import("./blockly-workspace"), { ssr: false }) as React.ComponentType<{ onCodeGenerated: (code: string) => void; onWorkspaceReady?: (ws: unknown) => void }>;

type WorkspaceRef = { xml: string; setXml: (xml: string) => void };

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

type Props = {
  visualCode: string;
  setVisualCode: (code: string) => void;
  onBack: () => void;
  tradingAdapter: BotTradingAdapter;
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function VisualBlocklyEditor({
  visualCode,
  setVisualCode,
  onBack,
  tradingAdapter,
}: Props) {
  const sandboxRef = useRef<BotSandbox | null>(null);
  const workspaceRef = useRef<WorkspaceRef | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [botStatus, setBotStatus] = useState<BotStatus>("idle");
  const [logs, setLogs] = useState<BotLogEntry[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [contract, setContract] = useState<ContractData | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);

  // Strategy persistence
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [activeStrategy, setActiveStrategy] = useState<SavedStrategy | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [strategyName, setStrategyName] = useState("");
  const [strategyDesc, setStrategyDesc] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---- Load strategy list on mount ---- */
  useEffect(() => {
    setStrategies(getStrategies());
  }, []);

  /* ---- Auto-save on code changes (debounced 3s) ---- */
  useEffect(() => {
    if (!activeStrategy || !visualCode.trim()) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      updateStrategy(activeStrategy.id, { xml: visualCode });
      setActiveStrategy((prev) => prev ? { ...prev, xml: visualCode, updatedAt: Date.now() } : prev);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, 3000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [visualCode, activeStrategy]);

  /* ---- Save strategy ---- */
  const handleSave = useCallback(() => {
    if (!visualCode.trim()) return;
    if (activeStrategy) {
      // Update existing
      const updated = updateStrategy(activeStrategy.id, {
        name: strategyName || activeStrategy.name,
        xml: visualCode,
        description: strategyDesc || activeStrategy.description,
      });
      if (updated) {
        setActiveStrategy(updated);
        setStrategies(getStrategies());
      }
    } else {
      // Save new
      const saved = saveStrategy(
        strategyName || `Strategy ${strategies.length + 1}`,
        visualCode,
        strategyDesc || undefined,
      );
      setActiveStrategy(saved);
      setStrategies(getStrategies());
    }
    setSaveStatus("saved");
    setShowSaveDialog(false);
    setTimeout(() => setSaveStatus("idle"), 2000);
  }, [visualCode, activeStrategy, strategyName, strategyDesc, strategies.length]);

  /* ---- Load strategy ---- */
  const handleLoad = useCallback((strategy: SavedStrategy) => {
    setActiveStrategy(strategy);
    setStrategyName(strategy.name);
    setStrategyDesc(strategy.description || "");
    setVisualCode(strategy.xml);
    setShowLoadDialog(false);
  }, [setVisualCode]);

  /* ---- Delete strategy ---- */
  const handleDelete = useCallback((id: string) => {
    deleteStrategy(id);
    setStrategies(getStrategies());
    if (activeStrategy?.id === id) {
      setActiveStrategy(null);
      setStrategyName("");
      setStrategyDesc("");
    }
  }, [activeStrategy]);

  /* ---- Duplicate strategy ---- */
  const handleDuplicate = useCallback((id: string) => {
    const dup = duplicateStrategy(id);
    if (dup) setStrategies(getStrategies());
  }, []);

  /* ---- New strategy (clear workspace) ---- */
  const handleNew = useCallback(() => {
    setActiveStrategy(null);
    setStrategyName("");
    setStrategyDesc("");
    setVisualCode("");
  }, [setVisualCode]);

  /* ---- Export to .xml file ---- */
  const handleExport = useCallback(() => {
    if (activeStrategy) {
      exportStrategyXml(activeStrategy);
    } else {
      // Export as unnamed
      const temp = { id: "temp", name: "strategy", xml: visualCode, createdAt: Date.now(), updatedAt: Date.now() } as SavedStrategy;
      exportStrategyXml(temp);
    }
  }, [activeStrategy, visualCode]);

  /* ---- Import from .xml file ---- */
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const xml = await importStrategyXml(file);
      const name = file.name.replace(/\.xml$/i, "");
      const saved = saveStrategy(name, xml);
      setActiveStrategy(saved);
      setStrategyName(name);
      setVisualCode(xml);
      setStrategies(getStrategies());
    } catch (err) {
      console.error("Import failed:", err);
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [setVisualCode]);

  /* ---- Start bot ---- */
  const handleStart = useCallback(async () => {
    if (!visualCode.trim()) return;
    const sandbox = new BotSandbox(tradingAdapter, {
      onStatusChange: (status) => setBotStatus(status),
      onLog: (entry) => setLogs((prev) => [...prev.slice(-200), entry]),
      onBalanceUpdate: (bal) => setBalance(bal),
      onProposalUpdate: (p) => setProposal(p),
      onContractUpdate: (c) => setContract(c),
      onTradeComplete: (c) => setContract(c),
    });
    sandboxRef.current = sandbox;
    setLogs([]);
    setBotStatus("running");
    try {
      await sandbox.run(visualCode);
    } catch (err) {
      console.error("Bot execution error:", err);
    }
  }, [visualCode, tradingAdapter]);

  /* ---- Stop / Pause / Resume ---- */
  const handleStop = useCallback(() => {
    sandboxRef.current?.stop();
    sandboxRef.current = null;
    setBotStatus("idle");
    setContract(null);
    setProposal(null);
  }, []);

  const handlePauseResume = useCallback(() => {
    if (botStatus === "running") sandboxRef.current?.pause();
    else if (botStatus === "paused") sandboxRef.current?.resume();
  }, [botStatus]);

  /* ---- Copy code ---- */
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(visualCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [visualCode]);

  const isRunning = botStatus === "running" || botStatus === "paused";

  return (
    <div className="bot-visual-editor">
      {showBacktest ? (
        <BacktestRunner visualCode={visualCode} onBack={() => setShowBacktest(false)} />
      ) : (
      <>
      {/* Header */}
      <div className="bot-header">
        <div>
          <p className="eyebrow">VISUAL BOT EDITOR</p>
          <h1>Build with blocks</h1>
          <p className="muted">
            {activeStrategy
              ? `Editing: ${activeStrategy.name}`
              : "Drag and drop blocks to create your strategy."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="back-btn" onClick={onBack}>← Back</button>
        </div>
      </div>

      {/* Strategy Toolbar */}
      <div className="strategy-toolbar">
        <div className="strategy-toolbar-left">
          <button className="strategy-btn" onClick={handleNew} title="New strategy">
            <IconPlus size={14} /> New
          </button>
          <button className="strategy-btn" onClick={() => setShowSaveDialog(true)} title="Save strategy">
            <IconDeviceFloppy size={14} /> {activeStrategy ? "Save" : "Save As"}
          </button>
          <button className="strategy-btn" onClick={() => setShowLoadDialog(true)} title="Load strategy">
            <IconFolderOpen size={14} /> Load
          </button>
          <button className="strategy-btn" onClick={handleExport} title="Export .xml file">
            <IconDownload size={14} /> Export
          </button>
          <button className="strategy-btn" onClick={() => fileInputRef.current?.click()} title="Import .xml file">
            <IconUpload size={14} /> Import
          </button>
          <input ref={fileInputRef} type="file" accept=".xml" style={{ display: "none" }} onChange={handleImport} />
          {saveStatus === "saved" && (
            <span className="save-indicator"><IconCheck size={12} /> Saved</span>
          )}
          {saveStatus === "saving" && (
            <span className="save-indicator saving">Saving…</span>
          )}
        </div>
      </div>

      {/* Execution Controls */}
      {/* Connection warning */}
      {!tradingAdapter.isConnected() && (
        <div className="blockly-connection-warning">
          ⚠ Connect to an account first to run bots with real trades.
        </div>
      )}

      <div className="blockly-controls">
        <div className="blockly-controls-left">
          {!isRunning ? (
            <>
              <button className="blockly-run-btn" onClick={handleStart} disabled={!visualCode.trim() || !tradingAdapter.isConnected()}>
                <IconPlayerPlay size={16} /> Run Bot
              </button>
              <button className="blockly-backtest-btn" onClick={() => setShowBacktest(true)} disabled={!visualCode.trim()}>
                <IconChartLine size={16} /> Backtest
              </button>
            </>
          ) : (
            <>
              <button className="blockly-pause-btn" onClick={handlePauseResume}>
                {botStatus === "paused"
                  ? <><IconPlayerPlay size={14} /> Resume</>
                  : <><IconPlayerPause size={14} /> Pause</>
                }
              </button>
              <button className="blockly-stop-btn" onClick={handleStop}>
                <IconPlayerStop size={14} /> Stop
              </button>
            </>
          )}
          <span className={`blockly-status-dot ${botStatus}`} />
          <span className="blockly-status-text">{botStatus}</span>
        </div>
        <div className="blockly-controls-right">
          {balance !== null && (
            <span className="blockly-balance">${balance.toFixed(2)}</span>
          )}
          {proposal && (
            <span className="blockly-proposal">
              Ask: ${proposal.ask_price.toFixed(2)} | Payout: ${proposal.payout.toFixed(2)}
            </span>
          )}
          {contract && (
            <span className={`blockly-contract ${contract.status}`}>
              {contract.status.toUpperCase()} | P/L: ${contract.profit.toFixed(2)}
            </span>
          )}
          <button className="blockly-log-toggle" onClick={() => setShowLog((v) => !v)}>
            📋 Log ({logs.length})
          </button>
        </div>
      </div>

      {/* Blockly Workspace */}
      <div className="blockly-editor-wrap">
        <BlocklyWorkspace onCodeGenerated={(code) => setVisualCode(code)} />
      </div>

      {/* Generated Code */}
      {visualCode && (
        <div className="visual-code-output">
          <div className="code-output-header">
            <span>Generated Code</span>
            <button className="copy-code-btn" onClick={handleCopy}>
              {copied ? <><IconCheck size={12} /> Copied</> : <><IconClipboard size={12} /> Copy</>}
            </button>
          </div>
          <pre>{visualCode}</pre>
        </div>
      )}

      {/* Log Panel */}
      {showLog && (
        <div className="blockly-log-panel">
          <div className="code-output-header">
            <span>Execution Log</span>
            <button className="copy-code-btn" onClick={() => setLogs([])}>Clear</button>
          </div>
          <div className="blockly-log-entries">
            {logs.length === 0 ? (
              <div className="blockly-log-empty">No log entries yet</div>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className={`blockly-log-entry ${entry.level}`}>
                  <span className="blockly-log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className={`blockly-log-level ${entry.level}`}>{entry.level}</span>
                  <span className="blockly-log-msg">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===== SAVE DIALOG ===== */}
      {showSaveDialog && (
        <div className="strategy-modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="strategy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="strategy-modal-header">
              <h3>{activeStrategy ? "Update Strategy" : "Save Strategy"}</h3>
              <button onClick={() => setShowSaveDialog(false)}><IconX size={16} /></button>
            </div>
            <div className="strategy-modal-body">
              <label>Name</label>
              <input
                type="text"
                value={strategyName}
                onChange={(e) => setStrategyName(e.target.value)}
                placeholder="My strategy"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
              <label>Description (optional)</label>
              <textarea
                value={strategyDesc}
                onChange={(e) => setStrategyDesc(e.target.value)}
                placeholder="What does this strategy do?"
                rows={3}
              />
            </div>
            <div className="strategy-modal-actions">
              <button className="strategy-modal-cancel" onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button className="strategy-modal-save" onClick={handleSave}>
                <IconDeviceFloppy size={14} /> {activeStrategy ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== LOAD DIALOG ===== */}
      {showLoadDialog && (
        <div className="strategy-modal-overlay" onClick={() => setShowLoadDialog(false)}>
          <div className="strategy-modal strategy-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="strategy-modal-header">
              <h3>Load Strategy</h3>
              <button onClick={() => setShowLoadDialog(false)}><IconX size={16} /></button>
            </div>
            <div className="strategy-modal-body">
              {strategies.length === 0 ? (
                <div className="strategy-list-empty">
                  <p>No saved strategies yet.</p>
                  <p className="muted">Build a strategy and click Save to store it here.</p>
                </div>
              ) : (
                <div className="strategy-list">
                  {strategies.map((s) => (
                    <div key={s.id} className={`strategy-list-item ${activeStrategy?.id === s.id ? "active" : ""}`}>
                      <div className="strategy-list-info" onClick={() => handleLoad(s)}>
                        <strong>{s.name}</strong>
                        {s.description && <p>{s.description}</p>}
                        <span className="strategy-list-date">
                          {new Date(s.updatedAt).toLocaleDateString()} {new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className="strategy-list-actions">
                        <button onClick={() => handleDuplicate(s.id)} title="Duplicate"><IconPlus size={12} /></button>
                        <button onClick={() => handleDelete(s.id)} title="Delete" className="delete-btn"><IconTrash size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}

      <style jsx>{`
        .blockly-backtest-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 16px; background: rgba(154, 142, 210, 0.1);
          color: #9a8ed2; border: 1px solid rgba(154, 142, 210, 0.3); border-radius: 8px;
          font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;
        }
        .blockly-backtest-btn:hover:not(:disabled) {
          transform: translateY(-1px); box-shadow: 0 4px 16px rgba(154, 142, 210, 0.2);
          border-color: #9a8ed2; color: #b8a8f0;
        }
        .blockly-backtest-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .blockly-connection-warning {
          padding: 10px 14px; margin-bottom: 8px;
          background: rgba(240, 192, 64, 0.08); border: 1px solid rgba(240, 192, 64, 0.3);
          border-radius: 8px; color: #f0c040; font-size: 12px;
        }
        .strategy-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: #0c141f;
          border: 1px solid var(--border);
          border-radius: 10px;
          margin-bottom: 8px;
        }
        .strategy-toolbar-left { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .strategy-btn {
          display: flex; align-items: center; gap: 4px;
          padding: 5px 10px; background: transparent;
          border: 1px solid var(--border); border-radius: 5px;
          color: var(--muted); font-size: 11px; cursor: pointer;
          transition: 0.15s;
        }
        .strategy-btn:hover { border-color: var(--teal); color: var(--text); }
        .save-indicator { font-size: 11px; color: var(--teal); display: flex; align-items: center; gap: 3px; }
        .save-indicator.saving { color: #f0c040; }
        .blockly-controls {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px 16px; background: #0c141f;
          border: 1px solid var(--border); border-radius: 10px;
          margin-bottom: 12px; flex-wrap: wrap; gap: 10px;
        }
        .blockly-controls-left, .blockly-controls-right { display: flex; align-items: center; gap: 10px; }
        .blockly-run-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 20px; background: linear-gradient(135deg, #37d4bd, #2db8a3);
          color: #0b1420; border: none; border-radius: 8px;
          font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.2s;
        }
        .blockly-run-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(55,212,189,.3); }
        .blockly-run-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .blockly-pause-btn, .blockly-stop-btn {
          display: flex; align-items: center; gap: 4px;
          padding: 7px 14px; border: 1px solid var(--border);
          border-radius: 6px; background: #1a2332; color: #d9e3ed;
          font-size: 12px; cursor: pointer; transition: 0.2s;
        }
        .blockly-pause-btn:hover { border-color: #f0c040; color: #f0c040; }
        .blockly-stop-btn:hover { border-color: #e05555; color: #e05555; }
        .blockly-status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .blockly-status-dot.idle { background: #718197; }
        .blockly-status-dot.running { background: #37d4bd; box-shadow: 0 0 8px #37d4bd; animation: ws-blink 1s infinite; }
        .blockly-status-dot.paused { background: #f0c040; animation: ws-blink 1s infinite; }
        .blockly-status-dot.stopped { background: #718197; }
        .blockly-status-dot.error { background: #e05555; box-shadow: 0 0 8px #e05555; }
        .blockly-status-text { font-size: 11px; color: var(--muted); text-transform: capitalize; }
        .blockly-balance { font-family: 'Space Grotesk'; font-size: 13px; font-weight: 600; color: #8de7d9; padding: 4px 10px; background: rgba(70,211,189,.08); border-radius: 6px; }
        .blockly-proposal, .blockly-contract { font-size: 11px; color: var(--muted); padding: 4px 8px; background: rgba(255,255,255,.04); border-radius: 4px; }
        .blockly-contract.won { color: #37d4bd; }
        .blockly-contract.lost { color: #e05555; }
        .blockly-log-toggle { padding: 6px 12px; background: transparent; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); font-size: 11px; cursor: pointer; }
        .blockly-log-toggle:hover { border-color: #9a8ed2; color: #d9e3ed; }
        .blockly-log-panel { margin-top: 12px; background: #0c141f; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
        .blockly-log-entries { max-height: 250px; overflow-y: auto; padding: 8px 12px; }
        .blockly-log-entry { display: flex; gap: 8px; font-size: 11px; font-family: 'JetBrains Mono', monospace; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,.03); }
        .blockly-log-time { color: #566477; min-width: 70px; }
        .blockly-log-level { min-width: 40px; font-weight: 600; text-transform: uppercase; }
        .blockly-log-level.info { color: #37d4bd; }
        .blockly-log-level.warn { color: #f0c040; }
        .blockly-log-level.error { color: #e05555; }
        .blockly-log-msg { color: #a0b0c0; }
        .blockly-log-empty { color: #566477; font-size: 12px; padding: 20px; text-align: center; }

        /* Strategy modals */
        .strategy-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 1000; display: flex; align-items: center; justify-content: center; }
        .strategy-modal { background: #1a2332; border: 1px solid var(--border); border-radius: 12px; width: 400px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; }
        .strategy-modal-wide { width: 560px; }
        .strategy-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .strategy-modal-header h3 { margin: 0; font-size: 15px; }
        .strategy-modal-header button { background: transparent; border: 0; color: var(--muted); cursor: pointer; padding: 4px; }
        .strategy-modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
        .strategy-modal-body label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 6px; margin-top: 12px; }
        .strategy-modal-body label:first-child { margin-top: 0; }
        .strategy-modal-body input, .strategy-modal-body textarea {
          width: 100%; padding: 8px 12px; background: #0c141f; border: 1px solid var(--border);
          border-radius: 6px; color: var(--text); font-size: 13px; outline: none; box-sizing: border-box;
        }
        .strategy-modal-body input:focus, .strategy-modal-body textarea:focus { border-color: var(--teal); }
        .strategy-modal-body textarea { resize: vertical; font-family: inherit; }
        .strategy-modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); }
        .strategy-modal-cancel { padding: 7px 14px; background: transparent; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); font-size: 12px; cursor: pointer; }
        .strategy-modal-save { display: flex; align-items: center; gap: 4px; padding: 7px 16px; background: var(--teal); color: #0b1420; border: 0; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }

        /* Strategy list */
        .strategy-list { display: flex; flex-direction: column; gap: 6px; }
        .strategy-list-item {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 14px; background: #0c141f; border: 1px solid var(--border);
          border-radius: 8px; cursor: pointer; transition: 0.15s;
        }
        .strategy-list-item:hover { border-color: var(--teal); }
        .strategy-list-item.active { border-color: var(--teal); background: rgba(70,211,189,.05); }
        .strategy-list-info { flex: 1; min-width: 0; }
        .strategy-list-info strong { font-size: 13px; display: block; }
        .strategy-list-info p { font-size: 11px; color: var(--muted); margin: 2px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .strategy-list-date { font-size: 10px; color: #566477; }
        .strategy-list-actions { display: flex; gap: 4px; }
        .strategy-list-actions button {
          padding: 4px 6px; background: transparent; border: 1px solid var(--border);
          border-radius: 4px; color: var(--muted); cursor: pointer; transition: 0.15s;
        }
        .strategy-list-actions button:hover { border-color: var(--teal); color: var(--text); }
        .strategy-list-actions .delete-btn:hover { border-color: #e05555; color: #e05555; }
        .strategy-list-empty { text-align: center; padding: 24px; color: var(--muted); font-size: 13px; }
        .strategy-list-empty .muted { font-size: 11px; margin-top: 8px; }

        @keyframes ws-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}

/**
 * Sandboxed bot execution engine using JS-Interpreter.
 *
 * Runs user-generated Blockly code inside a completely isolated
 * JavaScript environment. The sandbox provides a Bot API that
 * communicates with Deriv via WebSocket — the user code can never
 * access the real page, DOM, or network directly.
 *
 * Architecture:
 * ┌──────────────────────────────────────────┐
 * │  User Code (Blockly-generated JS)         │
 * │  Runs inside JS-Interpreter sandbox       │
 * │  Can call: Bot.setSymbol(), Bot.purchase()│
 * │  CANNOT: access window, document, fetch   │
 * └──────────────────────────────────────────┘
 *            ↕ Bot API bridge
 * ┌──────────────────────────────────────────┐
 * │  BotSandbox (host-side)                   │
 * │  Translates API calls to Deriv WS messages│
 * │  Feeds tick data back into sandbox        │
 * │  Controls execution flow (start/stop)     │
 * └──────────────────────────────────────────┘
 *            ↕ WebSocket
 * ┌──────────────────────────────────────────┐
 * │  Deriv Trading API (wss://api.derivws.com)│
 * └──────────────────────────────────────────┘
 */
import Interpreter from "js-interpreter";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type BotStatus =
  | "idle"
  | "running"
  | "paused"
  | "stopped"
  | "error";

export type BotLogEntry = {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
};

export type BotConfig = {
  id: string;
  name: string;
  symbol: string;
  contractType: string;
  tradeType: string;
  stake: number;
  duration: number;
  durationUnit: string;
  barrier?: number;
  dryRun: boolean;
};

export type ProposalData = {
  id: string;
  ask_price: number;
  payout: number;
  profit: number;
  spot: number;
  contract_type: string;
};

export type ContractData = {
  contract_id: string;
  status: string;
  profit: number;
  buy_price: number;
  payout: number;
  entry_tick?: number;
  current_tick?: number;
  exit_tick?: number;
  tick_count?: number;
  is_sold: boolean;
};

export type BotCallbacks = {
  onStatusChange?: (status: BotStatus) => void;
  onLog?: (entry: BotLogEntry) => void;
  onBalanceUpdate?: (balance: number) => void;
  onProposalUpdate?: (proposal: ProposalData | null) => void;
  onContractUpdate?: (contract: ContractData | null) => void;
  onTradeComplete?: (result: ContractData) => void;
};

/* ------------------------------------------------------------------ */
/*  Bot Sandbox                                                         */
/* ------------------------------------------------------------------ */

export class BotSandbox {
  private interpreter: Interpreter | null = null;
  private status: BotStatus = "idle";
  private callbacks: BotCallbacks;
  private abortController: AbortController | null = null;

  // Trading state
  private symbol = "1HZ100V";
  private contractType = "DIGITOVER";
  private tradeType = "DIGITOVER";
  private amount = 1;
  private basis = "stake";
  private duration = 5;
  private durationUnit = "t";
  private prediction = -1;
  private candleInterval = 60;
  private restartOnError = true;
  private timeMachineEnabled = false;
  private minStake = 0;
  private maxStake = 10000;
  private takeProfit = 0;
  private stopLoss = 0;

  // Runtime state
  private currentProposal: ProposalData | null = null;
  private activeContract: ContractData | null = null;
  private lastTradeResult: ContractData | null = null;
  private balance = 0;
  private totalProfit = 0;
  private totalStake = 0;
  private tradeCount = 0;
  private winCount = 0;
  private consecutiveLosses = 0;
  private tickCount = 0;
  private originalAmount = 1;

  // WebSocket
  private ws: WebSocket | null = null;
  private wsReady = false;
  private pendingCallbacks = new Map<string, (data: unknown) => void>();
  private nextWsId = 1;

  // Execution control
  private isPaused = false;
  private stepDelay = 50; // ms between execution steps

  constructor(callbacks: BotCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /* ---- Status management ---- */

  private setStatus(status: BotStatus) {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private log(message: string, level: BotLogEntry["level"] = "info") {
    const entry: BotLogEntry = { timestamp: Date.now(), level, message };
    this.callbacks.onLog?.(entry);
  }

  /* ---- WebSocket connection ---- */

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.wsReady = true;
          this.log("Connected to Deriv API");
          resolve();
        };

        this.ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          const reqId = msg.req_id as string | undefined;

          // Balance updates
          if (msg.msg_type === "balance") {
            const b = msg.balance;
            if (b) {
              this.balance = Number(b.balance) || 0;
              this.callbacks.onBalanceUpdate?.(this.balance);
            }
          }

          // Proposal responses
          if (msg.msg_type === "proposal") {
            if (msg.proposal?.id) {
              this.currentProposal = {
                id: msg.proposal.id,
                ask_price: Number(msg.proposal.ask_price) || 0,
                payout: Number(msg.proposal.payout) || 0,
                profit: Number(msg.proposal.profit) || 0,
                spot: Number(msg.proposal.spot) || 0,
                contract_type: msg.proposal.contract_type || "",
              };
              this.callbacks.onProposalUpdate?.(this.currentProposal);
            } else {
              this.currentProposal = null;
              this.callbacks.onProposalUpdate?.(null);
            }
          }

          // Buy responses
          if (msg.msg_type === "buy") {
            if (msg.buy?.contract_id) {
              this.activeContract = {
                contract_id: msg.buy.contract_id,
                status: "open",
                profit: 0,
                buy_price: this.currentProposal?.ask_price || 0,
                payout: this.currentProposal?.payout || 0,
                is_sold: false,
              };
              this.log(`Contract purchased: ${msg.buy.contract_id}`);
              this.callbacks.onContractUpdate?.(this.activeContract);

              // Subscribe to contract updates
              this.sendWs({
                proposal_open_contract: 1,
                contract_id: msg.buy.contract_id,
                subscribe: 1,
              });
            }
          }

          // Open contract updates
          if (msg.msg_type === "proposal_open_contract") {
            const c = msg.proposal_open_contract;
            if (c) {
              this.activeContract = {
                contract_id: c.contract_id || "",
                status: c.status || "open",
                profit: Number(c.profit) || 0,
                buy_price: Number(c.buy_price) || 0,
                payout: Number(c.payout) || 0,
                entry_tick: Number(c.entry_tick) || undefined,
                current_tick: Number(c.current_tick) || undefined,
                exit_tick: Number(c.exit_tick) || undefined,
                tick_count: Number(c.tick_count) || undefined,
                is_sold: !!c.is_sold,
              };
              this.callbacks.onContractUpdate?.(this.activeContract);

              // Contract settled
              if (["won", "lost", "sold", "expired"].includes(c.status)) {
                this.lastTradeResult = { ...this.activeContract };
                this.tradeCount++;
                this.totalProfit += this.activeContract.profit;
                if (this.activeContract.profit >= 0) {
                  this.winCount++;
                  this.consecutiveLosses = 0;
                } else {
                  this.consecutiveLosses++;
                }
                this.totalStake += this.activeContract.buy_price;
                this.callbacks.onTradeComplete?.(this.activeContract);
                this.log(
                  `Trade ${c.status}: profit=${this.activeContract.profit.toFixed(2)}`
                );
              }
            }
          }

          // Tick data
          if (msg.msg_type === "tick") {
            this.tickCount++;
          }

          // Resolve pending WS calls
          if (reqId && this.pendingCallbacks.has(reqId)) {
            this.pendingCallbacks.get(reqId)!(msg);
            this.pendingCallbacks.delete(reqId);
          }
        };

        this.ws.onerror = () => {
          this.log("WebSocket error", "error");
        };

        this.ws.onclose = () => {
          this.wsReady = false;
          this.log("WebSocket disconnected");
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private sendWs(msg: Record<string, unknown>): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;
    const id = String(this.nextWsId++);
    this.ws.send(JSON.stringify({ ...msg, req_id: id }));
    return id;
  }

  private sendWsAsync(msg: Record<string, unknown>, timeout = 10000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = this.sendWs(msg);
      if (!id) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const timer = setTimeout(() => {
        this.pendingCallbacks.delete(id);
        reject(new Error("Request timed out"));
      }, timeout);
      this.pendingCallbacks.set(id, (data) => {
        clearTimeout(timer);
        resolve(data as Record<string, unknown>);
      });
    });
  }

  /* ---- Proposal requests ---- */

  private async requestProposal(): Promise<ProposalData | null> {
    if (!this.wsReady) return null;
    try {
      const res = await this.sendWsAsync({
        proposal: 1,
        amount: this.amount,
        basis: this.basis,
        contract_type: this.tradeType,
        currency: "USD",
        duration: this.duration,
        duration_unit: this.durationUnit,
        underlying_symbol: this.symbol,
        ...(this.prediction >= 0 ? { barrier: this.prediction } : {}),
      }, 8000);

      const proposal = res.proposal as Record<string, unknown> | undefined;
      if (proposal?.id) {
        return {
          id: proposal.id as string,
          ask_price: Number(proposal.ask_price) || 0,
          payout: Number(proposal.payout) || 0,
          profit: Number(proposal.profit) || 0,
          spot: Number(proposal.spot) || 0,
          contract_type: (proposal.contract_type as string) || "",
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /* ---- Buy / Sell ---- */

  private async buyProposal(proposalId?: string): Promise<boolean> {
    const id = proposalId || this.currentProposal?.id;
    if (!id || !this.wsReady) return false;
    try {
      const res = await this.sendWsAsync({
        buy: id,
        price: this.amount,
      }, 8000);
      const buy = res.buy as Record<string, unknown> | undefined;
      return !!buy?.contract_id;
    } catch {
      return false;
    }
  }

  private sellContract(): void {
    if (this.activeContract && !this.activeContract.is_sold) {
      this.sendWs({ sell: this.activeContract.contract_id });
    }
  }

  /* ---- Sandbox API (exposed to user code) ---- */

  private createBotApi(): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    return {
      // Symbol / market
      setSymbol(sym: string) { self.symbol = sym; },
      getSymbol() { return self.symbol; },

      // Trade type
      setTradeType(type: string) { self.tradeType = type; },
      getTradeType() { return self.tradeType; },

      // Contract type
      setContractType(type: string) { self.contractType = type; },
      getContractType() { return self.contractType; },

      // Amount / stake
      setAmount(val: number) { self.amount = val; },
      getAmount() { return self.amount; },
      resetAmount() { self.amount = self.originalAmount; },

      // Basis
      setBasis(val: string) { self.basis = val; },

      // Duration
      setDuration(val: number) { self.duration = val; },
      setDurationUnit(val: string) { self.durationUnit = val; },

      // Prediction / barrier
      setPrediction(val: number) { self.prediction = val; },

      // Candle interval
      setCandleInterval(val: number) { self.candleInterval = val; },

      // Restart options
      setRestartOnError(val: boolean) { self.restartOnError = val; },
      setTimeMachineEnabled(val: boolean) { self.timeMachineEnabled = val; },

      // Risk management
      setMinStake(val: number) { self.minStake = val; },
      setMaxStake(val: number) { self.maxStake = val; },
      setTakeProfit(val: number) { self.takeProfit = val; },
      setStopLoss(val: number) { self.stopLoss = val; },

      // Proposal
      getProposalId() { return self.currentProposal?.id || ""; },
      getAskPrice() { return self.currentProposal?.ask_price || 0; },
      getPayout() { return self.currentProposal?.payout || 0; },
      getSpotPrice() { return self.currentProposal?.spot || 0; },
      isProposalValid() { return !!self.currentProposal?.id; },

      // Purchase
      purchase(contractType?: string) {
        if (contractType) {
          self.tradeType = contractType;
        }
        // Return a Promise-like that the interpreter can handle
        const result = self.buyProposal();
        self.setSandboxVar("__pendingPurchase", result);
      },

      // Sell
      sell() { self.sellContract(); },
      shouldSell() {
        return self.activeContract && !self.activeContract.is_sold;
      },

      // Contract state
      getContractProfit() { return self.activeContract?.profit || 0; },
      getContractStatus() { return self.activeContract?.status || "pending"; },
      getEntryTick() { return self.activeContract?.entry_tick || 0; },
      getCurrentTick() { return self.activeContract?.current_tick || 0; },
      getExitTick() { return self.activeContract?.exit_tick || 0; },
      getTickCount() { return self.activeContract?.tick_count || self.tickCount; },
      getContractDuration() { return self.duration; },

      // After-purchase state
      getTotalProfit() { return self.totalProfit; },
      getTotalStake() { return self.totalStake; },
      getWinCount() { return self.winCount; },
      getLossCount() { return self.consecutiveLosses; },
      getTradeCount() { return self.tradeCount; },

      // Balance
      getBalance() { return self.balance; },

      // Tick data
      getLastDigit() {
        // Return last digit from current tick
        const tick = self.activeContract?.current_tick || 0;
        return Number(tick.toFixed(2).replace(".", "").slice(-1));
      },
      getCandle(field: string) {
        // Simplified candle data (would need real OHLC from API)
        return 0;
      },

      // Logging
      log(msg: string) { self.log(String(msg)); },
      notify(msg: string, _sound: string) { self.log(`🔔 ${msg}`); },

      // Control flow
      waitTicks(_ticks: number) {
        // Implemented via pause in the execution loop
      },

      // Sleep helper (used by the execution loop)
      sleep(seconds: number) {
        // Will be implemented via async stepping
        return new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
      },
    };
  }

  /* ---- Interpreter setup ---- */

  private setSandboxVar(name: string, value: unknown): void {
    if (!this.interpreter) return;
    const scope = this.interpreter.getScope();
    this.interpreter.setProperty(scope, name, this.interpreter.createPrimitive(value as never));
  }

  private initInterpreter(code: string): void {
    const botApi = this.createBotApi();

    this.interpreter = new Interpreter(code, (interpreter, globalObject) => {
      // Create the Bot namespace in the sandbox
      const botObj = interpreter.createObject({});
      interpreter.setProperty(globalObject, "Bot", botObj);

      // Register all Bot API methods
      for (const [key, value] of Object.entries(botApi)) {
        if (typeof value === "function") {
          interpreter.setProperty(
            botObj,
            key,
            interpreter.createNativeFunction(value as (...args: unknown[]) => unknown)
          );
        } else {
          interpreter.setProperty(botObj, key, interpreter.createPrimitive(value as never));
        }
      }

      // Provide sleep function
      interpreter.setProperty(
        globalObject,
        "sleep",
        interpreter.createNativeFunction((...args: unknown[]) => {
          const secs = Number(args[0]) || 1;
          return new Promise<void>((resolve) => setTimeout(resolve, secs * 1000));
        })
      );

      // Provide watch function (for the main loop)
      interpreter.setProperty(
        globalObject,
        "watch",
        interpreter.createNativeFunction((...args: unknown[]) => {
          const phase = String(args[0]);
          return phase === "before" || phase === "during";
        })
      );

      // Console.log inside sandbox → bot log
      interpreter.setProperty(
        globalObject,
        "console",
        interpreter.createObject({
          log: interpreter.createNativeFunction((...args: unknown[]) => {
            self.log(args.map(String).join(" "));
          }),
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      // Math API (wrapped to match createNativeFunction signature)
      const mathObj = interpreter.createObject({});
      interpreter.setProperty(globalObject, "Math", mathObj);
      interpreter.setProperty(mathObj, "abs", interpreter.createNativeFunction((...a: unknown[]) => Math.abs(Number(a[0]))));
      interpreter.setProperty(mathObj, "max", interpreter.createNativeFunction((...a: unknown[]) => Math.max(...a.map(Number))));
      interpreter.setProperty(mathObj, "min", interpreter.createNativeFunction((...a: unknown[]) => Math.min(...a.map(Number))));
      interpreter.setProperty(mathObj, "floor", interpreter.createNativeFunction((...a: unknown[]) => Math.floor(Number(a[0]))));
      interpreter.setProperty(mathObj, "ceil", interpreter.createNativeFunction((...a: unknown[]) => Math.ceil(Number(a[0]))));
      interpreter.setProperty(mathObj, "random", interpreter.createNativeFunction(() => Math.random()));
      interpreter.setProperty(mathObj, "sqrt", interpreter.createNativeFunction((...a: unknown[]) => Math.sqrt(Number(a[0]))));
      interpreter.setProperty(mathObj, "pow", interpreter.createNativeFunction((...a: unknown[]) => Math.pow(Number(a[0]), Number(a[1]))));
      interpreter.setProperty(mathObj, "log", interpreter.createNativeFunction((...a: unknown[]) => Math.log(Number(a[0]))));

      // JSON.parse / JSON.stringify (wrapped for type safety)
      const jsonObj = interpreter.createObject({});
      interpreter.setProperty(globalObject, "JSON", jsonObj);
      interpreter.setProperty(jsonObj, "parse", interpreter.createNativeFunction((...a: unknown[]) => JSON.parse(String(a[0]))));
      interpreter.setProperty(jsonObj, "stringify", interpreter.createNativeFunction((...a: unknown[]) => JSON.stringify(a[0], a[1] as undefined)));

      // parseInt / parseFloat (wrapped)
      interpreter.setProperty(globalObject, "parseInt", interpreter.createNativeFunction((...a: unknown[]) => parseInt(String(a[0]), Number(a[1]) || undefined)));
      interpreter.setProperty(globalObject, "parseFloat", interpreter.createNativeFunction((...a: unknown[]) => parseFloat(String(a[0]))));
    });
  }

  /* ---- Execution loop ---- */

  async run(code: string, wsUrl?: string): Promise<void> {
    if (this.status === "running") {
      this.log("Bot is already running", "warn");
      return;
    }

    this.reset();
    this.originalAmount = this.amount;
    this.abortController = new AbortController();
    this.isPaused = false;

    // Connect WebSocket if URL provided
    if (wsUrl) {
      try {
        await this.connect(wsUrl);
      } catch (err) {
        this.log(`Failed to connect: ${err}`, "error");
        this.setStatus("error");
        return;
      }
    }

    this.setStatus("running");
    this.log("Bot started");

    try {
      this.initInterpreter(code);

      // Run the init function
      this.interpreter!.run();

      // Execute the main loop step by step
      await this.executeLoop();
    } catch (err) {
      this.log(`Execution error: ${err}`, "error");
      this.setStatus("error");
    }
  }

  private async executeLoop(): Promise<void> {
    if (!this.interpreter || this.status !== "running") return;

    const signal = this.abortController?.signal;

    while (!signal?.aborted && this.status === "running") {
      // Check pause
      if (this.isPaused) {
        await this.sleep(100);
        continue;
      }

      try {
        // Step through the interpreter
        // Each step executes a small chunk of JS
        const hasMore = this.interpreter.step();
        if (!hasMore) {
          this.log("Bot execution completed");
          break;
        }

        // Yield to browser event loop periodically
        if (this.tickCount % 100 === 0) {
          await this.sleep(this.stepDelay);
        }

        // Check risk limits
        if (this.takeProfit > 0 && this.totalProfit >= this.takeProfit) {
          this.log(`Take profit reached: $${this.totalProfit.toFixed(2)}`);
          break;
        }
        if (this.stopLoss > 0 && this.totalProfit <= -this.stopLoss) {
          this.log(`Stop loss reached: $${this.totalProfit.toFixed(2)}`);
          break;
        }
      } catch (err) {
        this.log(`Runtime error: ${err}`, "error");
        if (!this.restartOnError) {
          this.setStatus("error");
          return;
        }
        this.log("Restarting after error...");
      }
    }

    if (this.status === "running") {
      this.setStatus("stopped");
      this.log("Bot stopped");
    }
  }

  /* ---- Controls ---- */

  pause(): void {
    if (this.status === "running") {
      this.isPaused = true;
      this.setStatus("paused");
      this.log("Bot paused");
    }
  }

  resume(): void {
    if (this.status === "paused") {
      this.isPaused = false;
      this.setStatus("running");
      this.log("Bot resumed");
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.setStatus("stopped");
    this.log("Bot stopped");
    this.cleanup();
  }

  private reset(): void {
    this.currentProposal = null;
    this.activeContract = null;
    this.lastTradeResult = null;
    this.totalProfit = 0;
    this.totalStake = 0;
    this.tradeCount = 0;
    this.winCount = 0;
    this.consecutiveLosses = 0;
    this.tickCount = 0;
    this.amount = this.originalAmount || 1;
  }

  private cleanup(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsReady = false;
    this.pendingCallbacks.clear();
    this.interpreter = null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ---- Getters ---- */

  getStatus(): BotStatus { return this.status; }
  getBalance(): number { return this.balance; }
  getTotalProfit(): number { return this.totalProfit; }
  getTradeCount(): number { return this.tradeCount; }
  getActiveContract(): ContractData | null { return this.activeContract; }
  getCurrentProposal(): ProposalData | null { return this.currentProposal; }
}

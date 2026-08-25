/**
 * Sandboxed bot execution engine using JS-Interpreter.
 *
 * Runs user-generated Blockly code inside a completely isolated
 * JavaScript environment. The sandbox provides a Bot API that
 * communicates with Deriv via an injected trading adapter — the
 * user code can never access the real page, DOM, or network directly.
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
 * │  Calls adapter.propose/buy/sell           │
 * │  Feeds tick data back into sandbox        │
 * │  Controls execution flow (start/stop)     │
 * └──────────────────────────────────────────┘
 *            ↕ Trading Adapter
 * ┌──────────────────────────────────────────┐
 * │  useDerivTrading() WS connection          │
 * │  (shared authenticated session)           │
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

/**
 * Trading adapter — injected from useDerivTrading hook.
 * All trading WS calls go through this interface so the sandbox
 * reuses the existing authenticated session.
 */
/** Proposal result from the Deriv API */
export type AdapterProposal = {
  id: string;
  ask_price?: number;
  payout?: number;
  profit?: number;
  spot?: number;
};

/** Open contract result from the Deriv API */
export type AdapterContract = {
  contract_id: string;
  status?: string;
  profit?: number;
  buy_price?: number;
  payout?: number;
  entry_tick?: number;
  current_tick?: number;
  exit_tick?: number;
  is_sold?: boolean;
  tick_count?: number;
  contract_type?: string;
  underlying?: string;
  barrier?: string;
};

/** Contract update callback */
export type ContractUpdateCb = (c: AdapterContract) => void;

/**
 * Trading adapter — injected from useDerivTrading hook.
 * All trading WS calls go through this interface so the sandbox
 * reuses the existing authenticated session.
 */
export type BotTradingAdapter = {
  /** Request a new proposal from Deriv */
  propose: (req: {
    contract_type: string;
    symbol: string;
    amount: number;
    currency: string;
    duration_ticks: number;
    barrier?: string;
  }) => Promise<AdapterProposal | null>;
  /** Buy a proposal by ID */
  buy: (proposalId: string, price: number) => Promise<AdapterContract | null>;
  /** Buy via bot (skip auto-subscribe to reduce WS traffic) */
  buyBot?: (proposalId: string, price: number) => Promise<AdapterContract | null>;
  /** Sell an open contract */
  sell: (contractId: string) => void;
  /** Subscribe to open contract updates */
  subscribeToContract: (contractId: string, cb: ContractUpdateCb) => void;
  /** Unsubscribe from contract updates */
  unsubscribeFromContract: (contractId: string) => void;
  /** Get current account balance */
  getBalance: () => number | null;
  /** Check if WS is connected */
  isConnected: () => boolean;
};

/* ------------------------------------------------------------------ */
/*  Bot Sandbox                                                         */
/* ------------------------------------------------------------------ */

export class BotSandbox {
  private interpreter: Interpreter | null = null;
  private status: BotStatus = "idle";
  private callbacks: BotCallbacks;
  private adapter: BotTradingAdapter;
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

  // Execution control
  private isPaused = false;
  private stepDelay = 50; // ms between execution steps

  constructor(adapter: BotTradingAdapter, callbacks: BotCallbacks = {}) {
    this.adapter = adapter;
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

  /* ---- Trading operations via adapter ---- */

  private async requestProposal(): Promise<ProposalData | null> {
    if (!this.adapter.isConnected()) {
      this.log("WebSocket not connected — cannot request proposal", "warn");
      return null;
    }

    try {
      const result = await this.adapter.propose({
        contract_type: this.tradeType,
        symbol: this.symbol,
        amount: this.amount,
        currency: "USD",
        duration_ticks: this.duration,
        barrier: this.prediction >= 0 ? String(this.prediction) : undefined,
      });

      if (result) {
        return {
          id: result.id,
          ask_price: Number(result.ask_price) || 0,
          payout: Number(result.payout) || 0,
          profit: Number(result.profit) || 0,
          spot: Number(result.spot) || 0,
          contract_type: this.tradeType,
        };
      }
      return null;
    } catch (err) {
      this.log(`Proposal request failed: ${err}`, "error");
      return null;
    }
  }

  private async buyProposal(): Promise<boolean> {
    const proposalId = this.currentProposal?.id;
    if (!proposalId || !this.adapter.isConnected()) {
      this.log("No proposal to buy or WS not connected", "warn");
      return false;
    }

    try {
      // Use buyBot if available to skip auto-subscribe (reduces WS traffic)
      const buyFn = this.adapter.buyBot ?? this.adapter.buy;
      const result = await buyFn(proposalId, this.amount);

      if (result?.contract_id) {
        this.activeContract = {
          contract_id: result.contract_id,
          status: result.status || "open",
          profit: result.profit || 0,
          buy_price: result.buy_price || this.currentProposal?.ask_price || 0,
          payout: result.payout || this.currentProposal?.payout || 0,
          entry_tick: result.entry_tick,
          current_tick: result.current_tick,
          exit_tick: result.exit_tick,
          tick_count: result.tick_count,
          is_sold: !!result.is_sold,
        };
        this.log(`Contract purchased: ${result.contract_id}`);
        this.callbacks.onContractUpdate?.(this.activeContract);

        // Subscribe to contract updates via adapter
        this.adapter.subscribeToContract(result.contract_id, (c) => {
          this.handleContractUpdate(c);
        });

        // Also check if contract already settled in the buy response
        if (result.status && ["won", "lost", "sold", "expired"].includes(result.status)) {
          this.handleContractSettled(this.activeContract);
        }

        return true;
      }
      return false;
    } catch (err) {
      this.log(`Buy failed: ${err}`, "error");
      return false;
    }
  }

  private handleContractUpdate(c: AdapterContract): void {
    this.activeContract = {
      contract_id: c.contract_id,
      status: c.status || "open",
      profit: c.profit || 0,
      buy_price: c.buy_price || 0,
      payout: c.payout || 0,
      entry_tick: c.entry_tick,
      current_tick: c.current_tick,
      exit_tick: c.exit_tick,
      tick_count: c.tick_count,
      is_sold: !!c.is_sold,
    };
    this.callbacks.onContractUpdate?.(this.activeContract);

    // Track ticks
    if (c.current_tick) this.tickCount++;

    // Contract settled
    if (c.status && ["won", "lost", "sold", "expired"].includes(c.status)) {
      this.handleContractSettled(this.activeContract);
    }
  }

  private handleContractSettled(contract: ContractData): void {
    this.lastTradeResult = { ...contract };
    this.tradeCount++;
    this.totalProfit += contract.profit;
    if (contract.profit >= 0) {
      this.winCount++;
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
    }
    this.totalStake += contract.buy_price;
    this.callbacks.onTradeComplete?.(contract);
    this.log(`Trade ${contract.status}: profit=${contract.profit.toFixed(2)}`);

    // Unsubscribe from contract
    this.adapter.unsubscribeFromContract(contract.contract_id);
  }

  private sellContract(): void {
    if (this.activeContract && !this.activeContract.is_sold) {
      this.adapter.sell(this.activeContract.contract_id);
      this.log(`Selling contract: ${this.activeContract.contract_id}`);
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

      // Purchase — requests a proposal then buys it
      async purchase(contractType?: string) {
        if (contractType) {
          self.tradeType = contractType;
        }
        // Step 1: Request proposal
        self.log(`Requesting proposal: ${self.tradeType} on ${self.symbol}`);
        const proposal = await self.requestProposal();
        if (!proposal) {
          self.log("Failed to get proposal", "error");
          return false;
        }
        self.currentProposal = proposal;
        self.callbacks.onProposalUpdate?.(proposal);

        // Step 2: Buy
        self.log(`Buying: ask_price=${proposal.ask_price}, payout=${proposal.payout}`);
        const bought = await self.buyProposal();
        if (!bought) {
          self.log("Buy failed", "error");
        }
        return bought;
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
      getBalance() { return self.adapter.getBalance() ?? self.balance; },

      // Tick data
      getLastDigit() {
        const tick = self.activeContract?.current_tick || 0;
        return Number(tick.toFixed(2).replace(".", "").slice(-1));
      },
      getCandle(_field: string) {
        // Would need real OHLC from Deriv API — returns 0 as placeholder
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
        return new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
      },

      // Request proposal separately (for Before Purchase blocks)
      requestProposal() { return self.requestProposal(); },

      // Request buy directly with a proposal ID
      buyProposal(proposalId?: string) {
        if (proposalId) {
          self.currentProposal = { ...self.currentProposal, id: proposalId } as ProposalData;
        }
        return self.buyProposal();
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

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
            interpreter.createNativeFunction((...args: unknown[]) => {
              const result = (value as (...a: unknown[]) => unknown).apply(botApi, args);
              // Handle async functions (purchase, requestProposal, buyProposal)
              if (result && typeof (result as Promise<unknown>).then === "function") {
                return result as unknown;
              }
              return result;
            })
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

      // Math API
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

      // JSON.parse / JSON.stringify
      const jsonObj = interpreter.createObject({});
      interpreter.setProperty(globalObject, "JSON", jsonObj);
      interpreter.setProperty(jsonObj, "parse", interpreter.createNativeFunction((...a: unknown[]) => JSON.parse(String(a[0]))));
      interpreter.setProperty(jsonObj, "stringify", interpreter.createNativeFunction((...a: unknown[]) => JSON.stringify(a[0], a[1] as undefined)));

      // parseInt / parseFloat
      interpreter.setProperty(globalObject, "parseInt", interpreter.createNativeFunction((...a: unknown[]) => parseInt(String(a[0]), Number(a[1]) || undefined)));
      interpreter.setProperty(globalObject, "parseFloat", interpreter.createNativeFunction((...a: unknown[]) => parseFloat(String(a[0]))));
    });
  }

  /* ---- Execution loop ---- */

  async run(code: string): Promise<void> {
    if (this.status === "running") {
      this.log("Bot is already running", "warn");
      return;
    }

    this.reset();
    this.originalAmount = this.amount;
    this.abortController = new AbortController();
    this.isPaused = false;

    // Check adapter connection
    if (!this.adapter.isConnected()) {
      this.log("WebSocket not connected — please connect to an account first", "error");
      this.setStatus("error");
      return;
    }

    // Sync balance from adapter
    const adapterBalance = this.adapter.getBalance();
    if (adapterBalance !== null) {
      this.balance = adapterBalance;
      this.callbacks.onBalanceUpdate?.(this.balance);
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

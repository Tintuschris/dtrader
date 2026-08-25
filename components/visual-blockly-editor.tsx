"use client";

import { useCallback, useRef, useState } from "react";
import {
  IconPlayerPlay, IconPlayerStop, IconPlayerPause,
  IconPlayerRecord, IconClipboard, IconCheck,
} from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { BotSandbox, type BotStatus, type BotLogEntry, type ProposalData, type ContractData } from "../lib/bot-sandbox";

const BlocklyWorkspace = dynamic(() => import("./blockly-workspace"), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

type Props = {
  visualCode: string;
  setVisualCode: (code: string) => void;
  onBack: () => void;
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function VisualBlocklyEditor({
  visualCode,
  setVisualCode,
  onBack,
}: Props) {
  const sandboxRef = useRef<BotSandbox | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus>("idle");
  const [logs, setLogs] = useState<BotLogEntry[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [contract, setContract] = useState<ContractData | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLog, setShowLog] = useState(false);

  /* ---- Start bot ---- */
  const handleStart = useCallback(async () => {
    if (!visualCode.trim()) return;

    // Create sandbox with callbacks
    const sandbox = new BotSandbox({
      onStatusChange: (status) => setBotStatus(status),
      onLog: (entry) => setLogs((prev) => [...prev.slice(-200), entry]),
      onBalanceUpdate: (bal) => setBalance(bal),
      onProposalUpdate: (p) => setProposal(p),
      onContractUpdate: (c) => setContract(c),
      onTradeComplete: (c) => {
        setContract(c);
      },
    });

    sandboxRef.current = sandbox;
    setLogs([]);
    setBotStatus("running");

    // Run with sandboxed code
    try {
      // For now, run in the main thread with JS-Interpreter sandbox
      // In production, you'd connect to the Deriv WS URL here
      await sandbox.run(visualCode);
    } catch (err) {
      console.error("Bot execution error:", err);
    }
  }, [visualCode]);

  /* ---- Stop bot ---- */
  const handleStop = useCallback(() => {
    sandboxRef.current?.stop();
    sandboxRef.current = null;
    setBotStatus("idle");
    setContract(null);
    setProposal(null);
  }, []);

  /* ---- Pause / Resume ---- */
  const handlePauseResume = useCallback(() => {
    if (botStatus === "running") {
      sandboxRef.current?.pause();
    } else if (botStatus === "paused") {
      sandboxRef.current?.resume();
    }
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
      {/* Header */}
      <div className="bot-header">
        <div>
          <p className="eyebrow">VISUAL BOT EDITOR</p>
          <h1>Build with blocks</h1>
          <p className="muted">
            Drag and drop blocks to create your strategy. The code is generated automatically.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="back-btn" onClick={onBack}>← Back</button>
        </div>
      </div>

      {/* Execution Controls */}
      <div className="blockly-controls">
        <div className="blockly-controls-left">
          {!isRunning ? (
            <button
              className="blockly-run-btn"
              onClick={handleStart}
              disabled={!visualCode.trim()}
            >
              <IconPlayerPlay size={16} /> Run Bot
            </button>
          ) : (
            <>
              <button
                className="blockly-pause-btn"
                onClick={handlePauseResume}
              >
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
          <button
            className="blockly-log-toggle"
            onClick={() => setShowLog((v) => !v)}
          >
            📋 Log ({logs.length})
          </button>
        </div>
      </div>

      {/* Blockly Workspace */}
      <div className="blockly-editor-wrap">
        <BlocklyWorkspace
          onCodeGenerated={(code) => setVisualCode(code)}
        />
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
                  <span className="blockly-log-time">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`blockly-log-level ${entry.level}`}>{entry.level}</span>
                  <span className="blockly-log-msg">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .blockly-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #0c141f;
          border: 1px solid var(--border);
          border-radius: 10px;
          margin-bottom: 12px;
          flex-wrap: wrap;
          gap: 10px;
        }
        .blockly-controls-left, .blockly-controls-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .blockly-run-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 20px;
          background: linear-gradient(135deg, #37d4bd, #2db8a3);
          color: #0b1420;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .blockly-run-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(55, 212, 189, 0.3);
        }
        .blockly-run-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .blockly-pause-btn, .blockly-stop-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 7px 14px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: #1a2332;
          color: #d9e3ed;
          font-size: 12px;
          cursor: pointer;
          transition: 0.2s;
        }
        .blockly-pause-btn:hover { border-color: #f0c040; color: #f0c040; }
        .blockly-stop-btn:hover { border-color: #e05555; color: #e05555; }
        .blockly-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }
        .blockly-status-dot.idle { background: #718197; }
        .blockly-status-dot.running { background: #37d4bd; box-shadow: 0 0 8px #37d4bd; animation: ws-blink 1s infinite; }
        .blockly-status-dot.paused { background: #f0c040; animation: ws-blink 1s infinite; }
        .blockly-status-dot.stopped { background: #718197; }
        .blockly-status-dot.error { background: #e05555; box-shadow: 0 0 8px #e05555; }
        .blockly-status-text {
          font-size: 11px;
          color: var(--muted);
          text-transform: capitalize;
        }
        .blockly-balance {
          font-family: 'Space Grotesk';
          font-size: 13px;
          font-weight: 600;
          color: #8de7d9;
          padding: 4px 10px;
          background: rgba(70, 211, 189, 0.08);
          border-radius: 6px;
        }
        .blockly-proposal, .blockly-contract {
          font-size: 11px;
          color: var(--muted);
          padding: 4px 8px;
          background: rgba(255,255,255,0.04);
          border-radius: 4px;
        }
        .blockly-contract.won { color: #37d4bd; }
        .blockly-contract.lost { color: #e05555; }
        .blockly-log-toggle {
          padding: 6px 12px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--muted);
          font-size: 11px;
          cursor: pointer;
        }
        .blockly-log-toggle:hover { border-color: #9a8ed2; color: #d9e3ed; }
        .blockly-log-panel {
          margin-top: 12px;
          background: #0c141f;
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
        }
        .blockly-log-entries {
          max-height: 250px;
          overflow-y: auto;
          padding: 8px 12px;
        }
        .blockly-log-entry {
          display: flex;
          gap: 8px;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          padding: 3px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
        }
        .blockly-log-time { color: #566477; min-width: 70px; }
        .blockly-log-level { min-width: 40px; font-weight: 600; text-transform: uppercase; }
        .blockly-log-level.info { color: #37d4bd; }
        .blockly-log-level.warn { color: #f0c040; }
        .blockly-log-level.error { color: #e05555; }
        .blockly-log-msg { color: #a0b0c0; }
        .blockly-log-empty { color: #566477; font-size: 12px; padding: 20px; text-align: center; }
        @keyframes ws-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

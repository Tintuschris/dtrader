"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Blockly from "blockly/core";
import "blockly/blocks";
import "blockly/javascript";
import * as BlocklyLocale from "blockly/msg/en";
import { DTRADER_TOOLBOX, DEFAULT_WORKSPACE_XML } from "../lib/blockly-toolbox";
import { registerDTraderGenerator, generateBotCode } from "../lib/blockly-generator";
import { registerAllBlocks } from "../lib/blockly-blocks";
import StrategyPreviewPanel from "./strategy-preview-panel";
import { BotSandbox, type BotStatus, type BotLogEntry, type ProposalData, type ContractData, type BotTradingAdapter } from "../lib/bot-sandbox";

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

type Props = {
  onCodeGenerated: (code: string) => void;
  onXmlChange?: (xml: string) => void;
  initialXml?: string;
  tradingAdapter?: BotTradingAdapter | null;
};

/* ------------------------------------------------------------------ */
/*  Workspace Component                                                 */
/* ------------------------------------------------------------------ */

let blocklyInitialized = false;

function ensureBlocklyLocale() {
  if (blocklyInitialized) return;
  // Blockly 13+ uses setLocale to populate Msg with translations.
  // The blockly/msg/en module exports a locale object with all English strings.
  try {
    Blockly.setLocale(BlocklyLocale as unknown as Parameters<typeof Blockly.setLocale>[0]);
    // Verify it worked - if not, fall through to manual fallback
    if (!(Blockly.Msg as Record<string, unknown>).SCREENREADER_HINT) throw new Error('setLocale did not populate Msg');
  } catch {
    // Fallback: manually set the critical ARIA strings needed during inject
    const msg = Blockly.Msg as Record<string, string>;
    msg.SCREENREADER_HINT = "Use the arrow keys to navigate. Press %1 to toggle screenreader accessibility mode.";
    msg.WORKSPACE_ARIA_LABEL = "Current workspace: %1";
    msg.WORKSPACE_LABEL_PLAIN = "Blocks workspace.";
    msg.WORKSPACE_LABEL_MUTATOR_WORKSPACE = "Block editor workspace";
    msg.WORKSPACE_ROLEDESCRIPTION = "workspace";
  }
  blocklyInitialized = true;
}

export default function BlocklyWorkspace({
  onCodeGenerated,
  onXmlChange,
  initialXml,
  tradingAdapter,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [exported, setExported] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [blockCount, setBlockCount] = useState(0);

  // Bot execution state
  const sandboxRef = useRef<BotSandbox | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus>("idle");
  const [botLogs, setBotLogs] = useState<BotLogEntry[]>([]);
  const [botBalance, setBotBalance] = useState<number | null>(null);
  const [botProposal, setBotProposal] = useState<ProposalData | null>(null);
  const [botContract, setBotContract] = useState<ContractData | null>(null);
  const [showBotPanel, setShowBotPanel] = useState(false);
  const generatedCodeRef = useRef("");

  /* ---- initialize Blockly workspace ---- */
  useEffect(() => {
    if (!containerRef.current || workspaceRef.current) return;

    // Register custom blocks and generator (idempotent)
    registerAllBlocks();
    registerDTraderGenerator();

    // Initialize Blockly locale/Msg before inject
    ensureBlocklyLocale();

    const ws = Blockly.inject(containerRef.current, {
      toolbox: DTRADER_TOOLBOX,
      renderer: "zelos",
      grid: {
        spacing: 20,
        length: 3,
        colour: "#ccc",
        snap: true,
      },
      zoom: {
        controls: true,
        wheel: true,
        startScale: 0.9,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.2,
      },
      trashcan: true,
      scrollbars: true,
      sounds: false,
      theme: Blockly.Themes.Zelos,
    });

    workspaceRef.current = ws;

    // Load default or provided XML
    const xml = initialXml || DEFAULT_WORKSPACE_XML;
    try {
      const dom = Blockly.utils.xml.textToDom(xml);
      Blockly.Xml.domToWorkspace(dom, ws);
    } catch {
      console.warn("Failed to load initial workspace XML, using empty workspace");
    }

    // Listen for changes and generate code + XML
    ws.addChangeListener(() => {
      try {
        const code = generateBotCode(ws);
        onCodeGenerated(code);
        const dom = Blockly.Xml.workspaceToDom(ws);
        const xmlStr = Blockly.Xml.domToText(dom);
        onXmlChange?.(xmlStr);
      } catch {
        // Ignore generation errors during editing
      }
      // Update undo/redo state and block count
      try {
        const wsRef = workspaceRef.current;
        if (wsRef) {
          setCanUndo((wsRef as unknown as { getUndoStack: () => unknown[] }).getUndoStack().length > 0);
          setCanRedo((wsRef as unknown as { getRedoStack: () => unknown[] }).getRedoStack().length > 0);
          setBlockCount(wsRef.getAllBlocks(false).length);
        }
      } catch {
        // ignore
      }
    });

    setIsReady(true);

    return () => {
      ws.dispose();
      workspaceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Deriv Bot compatible XML export ---- */
  const handleExportXml = useCallback(() => {
    if (!workspaceRef.current) return;
    const dom = Blockly.Xml.workspaceToDom(workspaceRef.current);
    const xmlText = Blockly.Xml.domToText(dom);
    // Wrap in a Deriv Bot compatible XML envelope
    const derivBotXml = `<?xml version="1.0" encoding="UTF-8"?>\n<xml xmlns="http://www.w3.org/1999/xhtml" xmlns:blockly="http://www.w3.org/1999/xhtml">\n  <blockly:export_block>\n    <strategy>\n      <name>${new Date().toISOString().slice(0, 10)} Strategy</name>\n      <description>Exported from DTrader Visual Editor</description>\n      <block_type>block</block_type>\n      <version>2.0</version>\n    </strategy>\n    ${xmlText}\n  </blockly:export_block>\n</xml>`;
    const blob = new Blob([derivBotXml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deriv-bot-strategy-${Date.now()}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, []);

  /* ---- Also export raw Blockly XML (for direct Deriv Bot import) ---- */
  const handleExportRawXml = useCallback(() => {
    if (!workspaceRef.current) return;
    const dom = Blockly.Xml.workspaceToDom(workspaceRef.current);
    const xmlText = Blockly.Xml.domToText(dom);
    const blob = new Blob([xmlText], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blockly-workspace-${Date.now()}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, []);

  /* ---- Import XML from file ---- */
  const handleImportXml = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceRef.current) return;
    try {
      const text = await file.text();
      // Try to parse the XML
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "application/xml");
      const errorNode = doc.querySelector("parsererror");
      if (errorNode) {
        console.error("Invalid XML file");
        return;
      }
      // Look for Deriv Bot wrapper or raw Blockly XML
      const exportBlock = doc.querySelector("blockly\\:export_block, export_block");
      let blockXml: string;
      if (exportBlock) {
        // Deriv Bot format - extract the inner Blockly XML
        const innerXml = exportBlock.innerHTML;
        // Find the first <block element
        const blockMatch = innerXml.match(/<xml[\s\S]*?<\/xml>/);
        if (blockMatch) {
          blockXml = blockMatch[0];
        } else {
          // Try the export_block content directly
          blockXml = exportBlock.innerHTML.trim();
        }
      } else {
        // Raw Blockly XML
        blockXml = text;
      }
      const dom = Blockly.utils.xml.textToDom(blockXml);
      workspaceRef.current.clear();
      Blockly.Xml.domToWorkspace(dom, workspaceRef.current);
    } catch (err) {
      console.error("Failed to import XML:", err);
    }
    if (importInputRef.current) importInputRef.current.value = "";
  }, []);

  /* ---- Undo / Redo ---- */
  const handleUndo = useCallback(() => {
    workspaceRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    workspaceRef.current?.redo();
  }, []);

  /* ---- Zoom to fit ---- */
  const handleZoomToFit = useCallback(() => {
    workspaceRef.current?.zoomToFit();
  }, []);

  /* ---- Scroll center ---- */
  const handleScrollCenter = useCallback(() => {
    workspaceRef.current?.scrollCenter();
  }, []);

  /* ---- Copy XML to clipboard ---- */
  const handleCopyXml = useCallback(() => {
    if (!workspaceRef.current) return;
    const dom = Blockly.Xml.workspaceToDom(workspaceRef.current);
    const xmlText = Blockly.Xml.domToText(dom);
    navigator.clipboard.writeText(xmlText);
  }, []);

  /* ---- Bot execution ---- */
  const handleRunBot = useCallback(async () => {
    if (!tradingAdapter || !generatedCodeRef.current.trim()) return;
    const sandbox = new BotSandbox(tradingAdapter, {
      onStatusChange: (s) => setBotStatus(s),
      onLog: (entry) => setBotLogs((prev) => [...prev.slice(-200), entry]),
      onBalanceUpdate: (b) => setBotBalance(b),
      onProposalUpdate: (p) => setBotProposal(p),
      onContractUpdate: (c) => setBotContract(c),
      onTradeComplete: (c) => setBotContract(c),
    });
    sandboxRef.current = sandbox;
    setBotLogs([]);
    setBotContract(null);
    setBotProposal(null);
    setBotBalance(null);
    setShowBotPanel(true);
    try {
      await sandbox.run(generatedCodeRef.current);
    } catch (err) {
      setBotLogs((prev) => [...prev, { timestamp: Date.now(), level: "error", message: `Execution error: ${err}` }]);
    }
  }, [tradingAdapter]);

  const handleStopBot = useCallback(() => {
    sandboxRef.current?.stop();
    sandboxRef.current = null;
    setBotStatus("idle");
    setBotContract(null);
    setBotProposal(null);
  }, []);

  const handlePauseResume = useCallback(() => {
    if (botStatus === "running") sandboxRef.current?.pause();
    else if (botStatus === "paused") sandboxRef.current?.resume();
  }, [botStatus]);

  const isBotRunning = botStatus === "running" || botStatus === "paused";

  // Capture generated code for bot execution
  useEffect(() => {
    if (!workspaceRef.current) return;
    const sub = workspaceRef.current.addChangeListener(() => {
      try {
        const code = generateBotCode(workspaceRef.current!);
        generatedCodeRef.current = code;
      } catch { /* ignore */ }
    });
    return () => { sub(null as any); };
  }, [isReady]);

  return (
    <div className="blockly-wrapper">
      {/* Toolbar */}
      <div className="blockly-toolbar">
        {/* Undo / Redo */}
        <button className="blockly-tool-btn" onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↩ Undo
        </button>
        <button className="blockly-tool-btn" onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          ↪ Redo
        </button>
        <div className="blockly-toolbar-sep" />
        {/* View controls */}
        <button className="blockly-tool-btn" onClick={handleZoomToFit} title="Zoom to fit all blocks">
          ⊞ Fit
        </button>
        <button className="blockly-tool-btn" onClick={handleScrollCenter} title="Center the workspace view">
          ◎ Center
        </button>
        <div className="blockly-toolbar-sep" />
        {/* Block count */}
        <span className="blockly-block-count" title="Number of blocks in workspace">
          {blockCount} block{blockCount !== 1 ? "s" : ""}
        </span>
        <div className="blockly-toolbar-spacer" />
        {/* Export / Import */}
        <button className="blockly-tool-btn" onClick={handleExportXml} title="Export as Deriv Bot compatible .xml">
          📥 Export XML
        </button>
        <button className="blockly-tool-btn" onClick={handleExportRawXml} title="Export raw Blockly workspace XML">
          📋 Raw XML
        </button>
        <button className="blockly-tool-btn" onClick={() => importInputRef.current?.click()} title="Import a .xml file into workspace">
          📤 Import
        </button>
        <button className="blockly-tool-btn" onClick={handleCopyXml} title="Copy workspace XML to clipboard">
          📎 Copy
        </button>
        <div className="blockly-toolbar-sep" />
        {/* Bot execution controls */}
        {tradingAdapter && (
          <>
            {!isBotRunning ? (
              <button
                className="blockly-tool-btn run-bot-btn"
                onClick={handleRunBot}
                disabled={!generatedCodeRef.current.trim()}
                title="Run bot with generated code"
              >
                ▶ Run Bot
              </button>
            ) : (
              <>
                <button className="blockly-tool-btn pause-btn" onClick={handlePauseResume} title={botStatus === "paused" ? "Resume" : "Pause"}>
                  {botStatus === "paused" ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button className="blockly-tool-btn stop-btn" onClick={handleStopBot} title="Stop bot">
                  ⏹ Stop
                </button>
              </>
            )}
            <span className={`blockly-status-dot ${botStatus}`} title={`Bot: ${botStatus}`} />
            <div className="blockly-toolbar-sep" />
          </>
        )}
        <button
          className={`blockly-tool-btn ${showPreview ? "active" : ""}`}
          onClick={() => setShowPreview((v) => !v)}
          title="Toggle strategy preview panel"
        >
          📋 Preview
        </button>
        <input ref={importInputRef} type="file" accept=".xml" style={{ display: "none" }} onChange={handleImportXml} />
        {exported && <span className="blockly-export-ok">✓ Exported</span>}
      </div>
      <div className="blockly-body">
        <div ref={containerRef} className="blockly-container" />
        {showPreview && (
          <div className="blockly-preview-sidebar">
            <StrategyPreviewPanel workspace={workspaceRef.current} />
          </div>
        )}
        {showBotPanel && (
          <div className="blockly-bot-panel">
            <div className="bot-panel-header">
              <span className="bot-panel-title">🤖 Bot Execution</span>
              <button className="bot-panel-close" onClick={() => { handleStopBot(); setShowBotPanel(false); }}>✕</button>
            </div>
            <div className="bot-panel-status">
              <span className={`bot-status-badge ${botStatus}`}>{botStatus}</span>
              {botBalance !== null && (
                <span className="bot-balance">💰 ${botBalance.toFixed(2)}</span>
              )}
            </div>
            {botProposal && (
              <div className="bot-info-card">
                <span className="bot-info-label">Proposal</span>
                <span className="bot-info-value">${botProposal.ask_price.toFixed(2)} → ${botProposal.payout.toFixed(2)}</span>
              </div>
            )}
            {botContract && (
              <div className="bot-info-card">
                <span className="bot-info-label">Contract</span>
                <span className="bot-info-value">{botContract.status} — P/L: ${botContract.profit >= 0 ? "+" : ""}{botContract.profit.toFixed(2)}</span>
              </div>
            )}
            <div className="bot-log-section">
              <span className="bot-log-title">Logs ({botLogs.length})</span>
              <div className="bot-log-scroll">
                {botLogs.map((entry, i) => (
                  <div key={i} className={`bot-log-entry ${entry.level}`}>
                    <span className="bot-log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    <span className="bot-log-msg">{entry.message}</span>
                  </div>
                ))}
                {botLogs.length === 0 && <div className="bot-log-empty">No logs yet...</div>}
              </div>
            </div>
          </div>
        )}
      </div>
      <style jsx>{`
        .blockly-wrapper {
          width: 100%;
          height: 100%;
          position: relative;
          border-radius: 10px;
          overflow: hidden;
          background: #1a1a2e;
        }
        .blockly-toolbar {
          display: flex;
          gap: 6px;
          padding: 6px 10px;
          background: #0f1923;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          align-items: center;
        }
        .blockly-tool-btn {
          display: flex; align-items: center; gap: 4px;
          padding: 4px 10px; background: transparent;
          border: 1px solid rgba(255,255,255,0.1); border-radius: 5px;
          color: #8899aa; font-size: 11px; cursor: pointer;
          transition: 0.15s; white-space: nowrap;
        }
        .blockly-tool-btn:hover:not(:disabled) { border-color: #37d4bd; color: #37d4bd; background: rgba(55,212,189,0.05); }
        .blockly-tool-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .blockly-toolbar-sep { width: 1px; height: 18px; background: rgba(255,255,255,0.1); margin: 0 2px; }
        .blockly-toolbar-spacer { flex: 1; }
        .blockly-block-count { font-size: 10px; color: #566477; padding: 0 4px; white-space: nowrap; }
        .blockly-export-ok { font-size: 11px; color: #37d4bd; margin-left: 8px; }
        .blockly-body {
          display: flex;
          width: 100%;
          height: 100%;
        }
        .blockly-container {
          flex: 1;
          height: 100%;
          min-height: 500px;
        }
        .blockly-preview-sidebar {
          width: 320px;
          min-width: 320px;
          height: 100%;
          overflow-y: auto;
          padding: 10px;
          background: #0c141f;
          border-left: 1px solid rgba(255,255,255,0.08);
        }
        .blockly-tool-btn.active {
          border-color: #37d4bd; color: #37d4bd;
          background: rgba(55,212,189,0.1);
        }
        .run-bot-btn {
          border-color: rgba(55,212,189,0.4) !important;
          color: #37d4bd !important;
          font-weight: 600;
        }
        .run-bot-btn:hover:not(:disabled) { background: rgba(55,212,189,0.15) !important; }
        .pause-btn { border-color: rgba(240,192,64,0.4) !important; color: #f0c040 !important; }
        .stop-btn { border-color: rgba(224,85,85,0.4) !important; color: #e05555 !important; }
        .blockly-status-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #566477; flex-shrink: 0;
        }
        .blockly-status-dot.running { background: #37d4bd; box-shadow: 0 0 6px rgba(55,212,189,0.5); }
        .blockly-status-dot.paused { background: #f0c040; box-shadow: 0 0 6px rgba(240,192,64,0.5); }
        .blockly-status-dot.error { background: #e05555; box-shadow: 0 0 6px rgba(224,85,85,0.5); }

        /* Bot execution panel */
        .blockly-bot-panel {
          width: 320px; min-width: 320px; height: 100%;
          overflow-y: auto; display: flex; flex-direction: column;
          background: #0c141f; border-left: 1px solid rgba(255,255,255,0.08);
        }
        .bot-panel-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 12px; border-bottom: 1px solid #1e2d3d;
        }
        .bot-panel-title { font-size: 13px; font-weight: 700; color: #d9e3ed; }
        .bot-panel-close {
          background: none; border: none; color: #566477; cursor: pointer;
          font-size: 14px; padding: 2px 6px; border-radius: 4px;
        }
        .bot-panel-close:hover { color: #e05555; background: rgba(224,85,85,0.1); }
        .bot-panel-status {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; border-bottom: 1px solid #1e2d3d;
        }
        .bot-status-badge {
          font-size: 11px; font-weight: 700; padding: 2px 8px;
          border-radius: 4px; text-transform: uppercase;
        }
        .bot-status-badge.idle { background: rgba(86,100,119,0.2); color: #718197; }
        .bot-status-badge.running { background: rgba(55,212,189,0.15); color: #37d4bd; }
        .bot-status-badge.paused { background: rgba(240,192,64,0.15); color: #f0c040; }
        .bot-status-badge.error { background: rgba(224,85,85,0.15); color: #e05555; }
        .bot-balance { font-size: 13px; font-weight: 600; color: #37d4bd; }
        .bot-info-card {
          display: flex; justify-content: space-between; align-items: center;
          padding: 6px 12px; background: #111c2a; margin: 4px 8px;
          border-radius: 6px; font-size: 11px;
        }
        .bot-info-label { color: #718197; }
        .bot-info-value { color: #d9e3ed; font-weight: 600; font-family: monospace; }
        .bot-log-section { flex: 1; display: flex; flex-direction: column; padding: 8px; min-height: 0; }
        .bot-log-title { font-size: 11px; color: #718197; text-transform: uppercase; margin-bottom: 4px; }
        .bot-log-scroll {
          flex: 1; overflow-y: auto; background: #111c2a;
          border-radius: 6px; padding: 6px; max-height: 300px;
        }
        .bot-log-entry {
          display: flex; gap: 6px; padding: 2px 0; font-size: 10px;
          font-family: monospace; line-height: 1.4;
        }
        .bot-log-entry.info { color: #718197; }
        .bot-log-entry.warn { color: #f0c040; }
        .bot-log-entry.error { color: #e05555; }
        .bot-log-time { color: #3a4d62; flex-shrink: 0; }
        .bot-log-msg { color: #8899aa; word-break: break-all; }
        .bot-log-empty { color: #3a4d62; font-size: 11px; text-align: center; padding: 20px; }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public helpers (use with workspace ref)                             */
/* ------------------------------------------------------------------ */

export function getWorkspaceXml(ws: Blockly.WorkspaceSvg): string {
  const dom = Blockly.Xml.workspaceToDom(ws);
  return Blockly.Xml.domToText(dom);
}

export function loadWorkspaceXml(ws: Blockly.WorkspaceSvg, xml: string): void {
  const dom = Blockly.utils.xml.textToDom(xml);
  ws.clear();
  Blockly.Xml.domToWorkspace(dom, ws);
}

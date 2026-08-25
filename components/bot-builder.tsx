"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { IconX, IconSearch, IconPlayerStop, IconPlayerPlay, IconTrash, IconFileCode, IconDownload } from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { type BotConfig, type BotState, type BotTemplate, type BotWSDeps, BOT_TEMPLATES } from "./use-bot";
import { parseDerivBotXml, type ParsedBot } from "../lib/deriv-bot-xml-parser";
import { downloadBotXml, exportToDerivBotXml } from "../lib/deriv-bot-xml-exporter";
import {
  BOT_TEMPLATE_LIBRARY,
  TEMPLATE_CATEGORIES,
  searchTemplates,
  type BotTemplateEntry,
} from "../lib/bot-template-library";

const VisualBlocklyEditor = dynamic(() => import("./visual-blockly-editor"), { ssr: false });

type Market = { symbol: string; display_name: string };

type BotApi = {
  bots: BotState[];
  activeBotId: string | null;
  createBot: (config: BotConfig) => string;
  startBot: (id: string) => void;
  stopBot: (id: string) => void;
  pauseBot: (id: string) => void;
  resumeBot: (id: string) => void;
  deleteBot: (id: string) => void;
};

import { type BotTradingAdapter } from "../lib/bot-sandbox";

type Props = {
  markets: Market[];
  balance: number | null;
  balanceCurrency: string;
  botApi: BotApi;
  tradingAdapter: BotTradingAdapter;
};

type View = "templates" | "configure" | "runner" | "visual";

export default function BotBuilder({ markets, balance, balanceCurrency, botApi, tradingAdapter }: Props) {
  const { bots, createBot, startBot, stopBot, pauseBot, resumeBot, deleteBot } = botApi;
  const [view, setView] = useState<View>("templates");
  const [selectedTemplate, setSelectedTemplate] = useState<BotTemplate | null>(null);
  const [config, setConfig] = useState<Partial<BotConfig>>({});
  const [runningBotId, setRunningBotId] = useState<string | null>(null);
  const [xmlImport, setXmlImport] = useState<ParsedBot | null>(null);
  const [xmlError, setXmlError] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryCategory, setLibraryCategory] = useState<string>("all");
  const [librarySearch, setLibrarySearch] = useState("");
  const [previewTemplate, setPreviewTemplate] = useState<BotTemplateEntry | null>(null);
  const [visualCode, setVisualCode] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeBot = useMemo(
    () => bots.find((b) => b.config.id === runningBotId) ?? null,
    [bots, runningBotId],
  );

  const handleSelectTemplate = useCallback((template: BotTemplate) => {
    setSelectedTemplate(template);
    setConfig({
      name: template.name,
      strategy: template.strategy,
      symbol: markets[0]?.symbol ?? "1HZ100V",
      contract_type: template.defaultConfig.contract_type ?? "DIGITOVER",
      stake: template.defaultConfig.stake ?? 5,
      currency: "USD",
      duration_ticks: template.defaultConfig.duration_ticks ?? 5,
      barrier: template.defaultConfig.barrier,
      max_stake: template.defaultConfig.max_stake ?? 100,
      take_profit: 50,
      stop_loss: 30,
      max_trades: template.defaultConfig.max_trades ?? 50,
      martingale_multiplier: template.defaultConfig.martingale_multiplier ?? 2,
      dryRun: false,
    });
    setView("configure");
  }, [markets]);

  const handleStart = useCallback(() => {
    if (!selectedTemplate || !config.symbol) return;
    const fullConfig: BotConfig = {
      id: "",
      name: config.name ?? selectedTemplate.name,
      strategy: selectedTemplate.strategy,
      symbol: config.symbol,
      contract_type: config.contract_type ?? "DIGITOVER",
      stake: config.stake ?? 5,
      currency: balanceCurrency,
      duration_ticks: config.duration_ticks ?? 5,
      barrier: config.barrier,
      max_stake: config.max_stake ?? 100,
      take_profit: config.take_profit,
      stop_loss: config.stop_loss,
      max_trades: config.max_trades ?? 50,
      martingale_multiplier: config.martingale_multiplier ?? 2,
      dryRun: config.dryRun ?? false,
    };
    const id = createBot(fullConfig);
    setRunningBotId(id);
    startBot(id);
    setView("runner");
  }, [selectedTemplate, config, createBot, startBot, balanceCurrency]);

  const handleXmlImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setXmlError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseDerivBotXml(reader.result as string, file.name);
        setXmlImport(parsed);
      } catch (err) {
        setXmlError(err instanceof Error ? err.message : "Failed to parse XML");
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  }, []);

  const handleXmlConfirm = useCallback(() => {
    if (!xmlImport) return;
    const fullConfig: BotConfig = {
      id: "",
      name: xmlImport.config.name ?? xmlImport.xmlName,
      strategy: xmlImport.config.strategy ?? "constant",
      symbol: xmlImport.config.symbol ?? "1HZ100V",
      contract_type: xmlImport.config.contract_type ?? "DIGITOVER",
      stake: xmlImport.config.stake ?? 5,
      currency: balanceCurrency,
      duration_ticks: xmlImport.config.duration_ticks ?? 5,
      barrier: xmlImport.config.barrier,
      max_stake: 100,
      take_profit: xmlImport.config.take_profit,
      stop_loss: xmlImport.config.stop_loss,
      max_trades: xmlImport.config.max_trades ?? 50,
      martingale_multiplier: xmlImport.config.martingale_multiplier,
      dryRun: false,
    };
    setConfig(fullConfig);
    setSelectedTemplate({
      id: "imported",
      name: fullConfig.name,
      description: `Imported from Deriv Bot XML — ${Object.keys(xmlImport.variables).length} variables detected`,
      strategy: fullConfig.strategy,
      icon: "📄",
      defaultConfig: fullConfig,
    });
    setXmlImport(null);
    setView("configure");
  }, [xmlImport, balanceCurrency]);

  const filteredLibrary = useMemo(() => {
    const base = libraryCategory === "all"
      ? BOT_TEMPLATE_LIBRARY
      : BOT_TEMPLATE_LIBRARY.filter((t) => t.category === libraryCategory);
    if (!librarySearch) return base;
    const q = librarySearch.toLowerCase();
    return base.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [libraryCategory, librarySearch]);

  const handleImportFromLibrary = useCallback((entry: BotTemplateEntry) => {
    const c = entry.config;
    setConfig({
      name: c.name,
      strategy: c.strategy,
      symbol: c.symbol,
      contract_type: c.contract_type,
      stake: c.stake,
      currency: balanceCurrency,
      duration_ticks: c.duration_ticks,
      barrier: c.barrier,
      max_stake: c.max_stake ?? 100,
      take_profit: c.take_profit,
      stop_loss: c.stop_loss,
      max_trades: c.max_trades ?? 50,
      martingale_multiplier: c.martingale_multiplier,
      dryRun: false,
    });
    setSelectedTemplate({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      strategy: entry.config.strategy,
      icon: entry.icon,
      defaultConfig: entry.config,
    });
    setShowLibrary(false);
    setPreviewTemplate(null);
    setView("configure");
  }, [balanceCurrency]);

  const fmt = (n: number) => Number(n).toFixed(2);
  const fmtDuration = (ms: number) => {
    if (!ms) return "0s";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <div className="bot-builder">
      {/* ===== XML IMPORT PREVIEW MODAL ===== */}
      {xmlImport && (
        <div className="xml-import-modal-overlay" onClick={() => setXmlImport(null)}>
          <div className="xml-import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="xml-import-header">
              <h2><IconFileCode size={20} /> Imported Bot Strategy</h2>
              <button className="xml-import-close" onClick={() => setXmlImport(null)}><IconX size={16} /></button>
            </div>
            <div className="xml-import-body">
              <div className="xml-import-name">{xmlImport.xmlName}</div>

              {xmlImport.parseWarnings.length > 0 && (
                <div className="xml-import-warnings">
                  {xmlImport.parseWarnings.map((w, i) => (
                    <div key={i} className="xml-import-warning">⚠ {w}</div>
                  ))}
                </div>
              )}

              <div className="xml-import-grid">
                <div className="xml-import-item"><span>Market</span><strong>{xmlImport.config.symbol ?? "—"}</strong></div>
                <div className="xml-import-item"><span>Contract</span><strong>{xmlImport.config.contract_type?.replace("DIGIT", "") ?? "—"}</strong></div>
                <div className="xml-import-item"><span>Stake</span><strong>${fmt(xmlImport.config.stake ?? 0)}</strong></div>
                <div className="xml-import-item"><span>Duration</span><strong>{xmlImport.config.duration_ticks} ticks</strong></div>
                {xmlImport.config.barrier && (
                  <div className="xml-import-item"><span>Digit</span><strong>#{xmlImport.config.barrier}</strong></div>
                )}
                <div className="xml-import-item"><span>Strategy</span><strong>{xmlImport.config.strategy?.replace("_", " ") ?? "constant"}</strong></div>
                {xmlImport.config.take_profit && (
                  <div className="xml-import-item"><span>Take Profit</span><strong className="positive">+${fmt(xmlImport.config.take_profit)}</strong></div>
                )}
                {xmlImport.config.stop_loss && (
                  <div className="xml-import-item"><span>Stop Loss</span><strong className="negative">-${fmt(xmlImport.config.stop_loss)}</strong></div>
                )}
              </div>

              {Object.keys(xmlImport.variables).length > 0 && (
                <div className="xml-import-variables">
                  <h4>Variables</h4>
                  <div className="xml-import-var-list">
                    {Object.entries(xmlImport.variables).map(([name, val]) => (
                      <div key={name} className="xml-import-var">
                        <span>{name}</span><strong>{typeof val === "number" ? fmt(val) : val}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="xml-import-actions">
              <button className="back-btn" onClick={() => setXmlImport(null)}>Cancel</button>
              <button className="start-bot-btn" onClick={handleXmlConfirm}>✓ Import & Configure</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== XML ERROR ===== */}
      {xmlError && (
        <div className="xml-import-error" onClick={() => setXmlError(null)}>
          <span><IconX size={14} /> {xmlError}</span>
        </div>
      )}
      {/* ===== TEMPLATE LIBRARY ===== */}
      {showLibrary && (
        <div className="bot-templates-view">
          <div className="bot-header">
            <div>
              <button className="back-btn" onClick={() => { setShowLibrary(false); setPreviewTemplate(null); }}>← Back to Builder</button>
              <p className="eyebrow">TEMPLATE LIBRARY</p>
              <h1>📚 {TEMPLATE_CATEGORIES.find((c) => c.id === libraryCategory)?.icon} {TEMPLATE_CATEGORIES.find((c) => c.id === libraryCategory)?.label}</h1>
              <p className="muted">Browse pre-built strategies. Click any template to preview and import.</p>
            </div>
          </div>

          {/* Category tabs */}
          <div className="library-categories">
            {TEMPLATE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`library-cat-btn ${libraryCategory === cat.id ? "active" : ""}`}
                onClick={() => setLibraryCategory(cat.id)}
              >
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="library-search-wrap">
            <input
              type="text"
              className="library-search"
              placeholder="Search templates..."
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
            />
            {librarySearch && (
              <button className="library-search-clear" onClick={() => setLibrarySearch("")}><IconX size={14} /></button>
            )}
            <span className="library-count">{filteredLibrary.length} template{filteredLibrary.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Template grid */}
          <div className="library-grid">
            {filteredLibrary.length === 0 ? (
              <div className="library-empty">
                <span className="library-empty-icon">🔍</span>
                <p>No templates match your search.</p>
              </div>
            ) : (
              filteredLibrary.map((entry) => (
                <button
                  key={entry.id}
                  className="library-card"
                  onClick={() => setPreviewTemplate(entry)}
                >
                  <div className="library-card-header">
                    <span className="library-card-icon">{entry.icon}</span>
                    <div className="library-card-badges">
                      <span className={`risk-badge ${entry.riskLevel}`}>{entry.riskLevel}</span>
                      <span className={`diff-badge ${entry.difficulty}`}>{entry.difficulty}</span>
                    </div>
                  </div>
                  <h3 className="library-card-name">{entry.name}</h3>
                  <p className="library-card-desc">{entry.description}</p>
                  <div className="library-card-meta">
                    <span>{entry.config.symbol}</span>
                    <span>{entry.config.contract_type?.replace("DIGIT", "")}</span>
                    <span>${fmt(entry.config.stake)}</span>
                    <span>{entry.config.duration_ticks}t</span>
                  </div>
                  <div className="library-card-tags">
                    {entry.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="library-tag">{tag}</span>
                    ))}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===== TEMPLATE LIBRARY PREVIEW MODAL ===== */}
      {previewTemplate && (
        <div className="xml-import-modal-overlay" onClick={() => setPreviewTemplate(null)}>
          <div className="xml-import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="xml-import-header">
              <h2>{previewTemplate.icon} {previewTemplate.name}</h2>
              <button className="xml-import-close" onClick={() => setPreviewTemplate(null)}><IconX size={16} /></button>
            </div>
            <div className="xml-import-body">
              <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 14 }}>{previewTemplate.description}</p>

              <div className="xml-import-grid">
                <div className="xml-import-item"><span>Market</span><strong>{previewTemplate.config.symbol}</strong></div>
                <div className="xml-import-item"><span>Contract</span><strong>{previewTemplate.config.contract_type?.replace("DIGIT", "")}</strong></div>
                <div className="xml-import-item"><span>Stake</span><strong>${fmt(previewTemplate.config.stake)}</strong></div>
                <div className="xml-import-item"><span>Duration</span><strong>{previewTemplate.config.duration_ticks} ticks</strong></div>
                {previewTemplate.config.barrier && (
                  <div className="xml-import-item"><span>Digit</span><strong>#{previewTemplate.config.barrier}</strong></div>
                )}
                <div className="xml-import-item"><span>Strategy</span><strong>{previewTemplate.config.strategy?.replace("_", " ")}</strong></div>
                {previewTemplate.config.martingale_multiplier && (
                  <div className="xml-import-item"><span>Multiplier</span><strong>{previewTemplate.config.martingale_multiplier}x</strong></div>
                )}
                {previewTemplate.config.take_profit && (
                  <div className="xml-import-item"><span>Take Profit</span><strong className="positive">+${fmt(previewTemplate.config.take_profit)}</strong></div>
                )}
                {previewTemplate.config.stop_loss && (
                  <div className="xml-import-item"><span>Stop Loss</span><strong className="negative">-${fmt(previewTemplate.config.stop_loss)}</strong></div>
                )}
              </div>

              <div className="library-preview-tags">
                {previewTemplate.tags.map((tag) => (
                  <span key={tag} className="library-tag">{tag}</span>
                ))}
              </div>

              <div className="library-preview-meta">
                <span className={`risk-badge ${previewTemplate.riskLevel}`}>Risk: {previewTemplate.riskLevel}</span>
                <span className={`diff-badge ${previewTemplate.difficulty}`}>Level: {previewTemplate.difficulty}</span>
              </div>
            </div>
            <div className="xml-import-actions">
              <button className="back-btn" onClick={() => setPreviewTemplate(null)}>Cancel</button>
              <button className="export-xml-btn" onClick={() => downloadBotXml(previewTemplate.config)}>📄 Export XML</button>
              <button className="start-bot-btn" onClick={() => handleImportFromLibrary(previewTemplate)}>✓ Import & Configure</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TEMPLATE SELECTION ===== */}
      {view === "templates" && !showLibrary && (
        <div className="bot-templates-view">
          <div className="bot-header">
            <div>
              <p className="eyebrow">BOT BUILDER</p>
              <h1>Build a trading bot</h1>
              <p className="muted">Choose a strategy template, configure parameters, and run automated trades. Or import a Deriv Bot XML file.</p>
            </div>
          </div>
          <div className="bot-templates-grid">
            {BOT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                className="bot-template-card"
                onClick={() => handleSelectTemplate(template)}
              >
                <span className="bot-template-icon">{template.icon}</span>
                <h3>{template.name}</h3>
                <p>{template.description}</p>
                <span className="bot-template-strategy">{template.strategy.replace("_", " ")}</span>
              </button>
            ))}

            {/* Import XML card */}
            <button
              className="bot-template-card import-xml-card"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="bot-template-icon"><IconFileCode size={20} /></span>
              <h3>Import XML</h3>
              <p>Import a Deriv Bot (.xml) strategy file and run it here.</p>
              <span className="bot-template-strategy">dbot.deriv.com</span>
            </button>

            {/* Library card */}
            <button
              className="bot-template-card library-card"
              onClick={() => setShowLibrary(true)}
            >
              <span className="bot-template-icon">📚</span>
              <h3>Template Library</h3>
              <p>Browse {BOT_TEMPLATE_LIBRARY.length} pre-built strategies. Filter by risk, category, and more.</p>
              <span className="bot-template-strategy">{BOT_TEMPLATE_LIBRARY.length} templates</span>
            </button>

            {/* Visual Blockly editor card */}
            <button
              className="bot-template-card visual-editor-card"
              onClick={() => setView("visual")}
            >
              <span className="bot-template-icon">🧩</span>
              <h3>Visual Editor</h3>
              <p>Build a custom strategy with drag-and-drop blocks. Full control over trade logic, conditions, and tick analysis.</p>
              <span className="bot-template-strategy">blockly • no code</span>
            </button>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml"
            style={{ display: "none" }}
            onChange={handleXmlImport}
          />

          {/* Running bots list */}
          {bots.length > 0 && (
            <div className="bot-list-section">
              <h2>Your Bots</h2>
              <div className="bot-list">
                {bots.map((bot) => (
                  <BotCard
                    key={bot.config.id}
                    bot={bot}
                    onStart={() => startBot(bot.config.id)}
                    onStop={() => stopBot(bot.config.id)}
                    onPause={() => pauseBot(bot.config.id)}
                    onResume={() => resumeBot(bot.config.id)}
                    onDelete={() => deleteBot(bot.config.id)}
                    onSelect={() => { setRunningBotId(bot.config.id); setView("runner"); }}
                    fmt={fmt}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== CONFIGURATION ===== */}
      {view === "configure" && selectedTemplate && (
        <div className="bot-config-view">
          <div className="bot-header">
            <button className="back-btn" onClick={() => setView("templates")}>← Back</button>
            <div>
              <p className="eyebrow">CONFIGURE BOT</p>
              <h1>{selectedTemplate.icon} {selectedTemplate.name}</h1>
              <p className="muted">{selectedTemplate.description}</p>
            </div>
          </div>

          <div className="bot-config-grid">
            <div className="bot-config-form panel">
              {/* Market */}
              <div className="field-group">
                <label>Market</label>
                <select
                  className="bot-select"
                  value={config.symbol}
                  onChange={(e) => setConfig((c) => ({ ...c, symbol: e.target.value }))}
                >
                  {markets.map((m) => (
                    <option key={m.symbol} value={m.symbol}>{m.display_name}</option>
                  ))}
                </select>
              </div>

              {/* Contract Type */}
              <div className="field-group">
                <label>Contract Type</label>
                <select
                  className="bot-select"
                  value={config.contract_type}
                  onChange={(e) => setConfig((c) => ({ ...c, contract_type: e.target.value }))}
                >
                  <option value="DIGITOVER">Over</option>
                  <option value="DIGITUNDER">Under</option>
                  <option value="DIGITMATCH">Match</option>
                  <option value="DIGITDIFF">Differs</option>
                  <option value="DIGITEVEN">Even</option>
                  <option value="DIGITODD">Odd</option>
                </select>
              </div>

              {/* Barrier / Digit Prediction */}
              {["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(config.contract_type ?? "") && (
                <div className="field-group">
                  <label>Digit Prediction (0-9)</label>
                  <div className="digit-picker">
                    {Array.from({ length: 10 }, (_, i) => (
                      <button
                        key={i}
                        className={`digit-pick ${config.barrier === String(i) ? "active" : ""}`}
                        onClick={() => setConfig((c) => ({ ...c, barrier: String(i) }))}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Stake */}
              <div className="bot-config-row">
                <div className="field-group">
                  <label>Base Stake ({balanceCurrency})</label>
                  <input
                    type="number"
                    className="bot-input"
                    value={config.stake}
                    onChange={(e) => setConfig((c) => ({ ...c, stake: parseFloat(e.target.value) || 0 }))}
                    min="0.35"
                    step="0.5"
                  />
                </div>
                <div className="field-group">
                  <label>Duration (ticks)</label>
                  <select
                    className="bot-select"
                    value={config.duration_ticks}
                    onChange={(e) => setConfig((c) => ({ ...c, duration_ticks: parseInt(e.target.value) }))}
                  >
                    <option value={1}>1 tick</option>
                    <option value={5}>5 ticks</option>
                    <option value={10}>10 ticks</option>
                    <option value={15}>15 ticks</option>
                    <option value={25}>25 ticks</option>
                  </select>
                </div>
              </div>

              {/* Strategy-specific: Martingale multiplier */}
              {(config.strategy === "martingale" || config.strategy === "anti_martingale") && (
                <div className="bot-config-row">
                  <div className="field-group">
                    <label>Multiplier</label>
                    <select
                      className="bot-select"
                      value={config.martingale_multiplier}
                      onChange={(e) => setConfig((c) => ({ ...c, martingale_multiplier: parseFloat(e.target.value) }))}
                    >
                      <option value={1.5}>1.5x</option>
                      <option value={2}>2x</option>
                      <option value={2.5}>2.5x</option>
                      <option value={3}>3x</option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Max Stake</label>
                    <input
                      type="number"
                      className="bot-input"
                      value={config.max_stake}
                      onChange={(e) => setConfig((c) => ({ ...c, max_stake: parseFloat(e.target.value) || 100 }))}
                    />
                  </div>
                </div>
              )}

              {/* Limits */}
              <div className="bot-config-row">
                <div className="field-group">
                  <label>Take Profit ($)</label>
                  <input
                    type="number"
                    className="bot-input"
                    value={config.take_profit ?? ""}
                    onChange={(e) => setConfig((c) => ({ ...c, take_profit: parseFloat(e.target.value) || undefined }))}
                    placeholder="No limit"
                  />
                </div>
                <div className="field-group">
                  <label>Stop Loss ($)</label>
                  <input
                    type="number"
                    className="bot-input"
                    value={config.stop_loss ?? ""}
                    onChange={(e) => setConfig((c) => ({ ...c, stop_loss: parseFloat(e.target.value) || undefined }))}
                    placeholder="No limit"
                  />
                </div>
              </div>

              <div className="field-group">
                <label>Max Trades</label>
                <input
                  type="number"
                  className="bot-input"
                  value={config.max_trades}
                  onChange={(e) => setConfig((c) => ({ ...c, max_trades: parseInt(e.target.value) || 50 }))}
                />
              </div>

              {/* Dry Run Toggle */}
              <div className="field-group">
                <label className="dry-run-toggle">
                  <input
                    type="checkbox"
                    checked={config.dryRun ?? false}
                    onChange={(e) => setConfig((c) => ({ ...c, dryRun: e.target.checked }))}
                  />
                  <span className="dry-run-slider" />
                  <span className="dry-run-text">
                    Dry Run Mode
                    <small>Get real proposals but don&apos;t execute trades</small>
                  </span>
                </label>
              </div>

              <div className="bot-config-actions">
                <button className="back-btn" onClick={() => setView("templates")}>Cancel</button>
                <button className="export-xml-btn" onClick={() => {
                  if (!selectedTemplate || !config.symbol) return;
                  const fullConfig: BotConfig = {
                    id: "", name: config.name ?? selectedTemplate.name, strategy: selectedTemplate.strategy,
                    symbol: config.symbol, contract_type: config.contract_type ?? "DIGITOVER",
                    stake: config.stake ?? 5, currency: balanceCurrency, duration_ticks: config.duration_ticks ?? 5,
                    barrier: config.barrier, max_stake: 100, take_profit: config.take_profit,
                    stop_loss: config.stop_loss, max_trades: config.max_trades ?? 50,
                    martingale_multiplier: config.martingale_multiplier, dryRun: config.dryRun ?? false,
                  };
                  downloadBotXml(fullConfig);
                }}><IconDownload size={14} /> Export XML</button>
                <button className="start-bot-btn" onClick={handleStart}>
                  <IconPlayerPlay size={16} /> {config.dryRun ? 'Start Dry Run' : 'Start Bot'}
                </button>
              </div>
            </div>

            {/* Config summary */}
            <div className="bot-config-summary panel">
              <h3>Strategy Summary</h3>
              <div className="summary-items">
                <div className="summary-item"><span>Strategy</span><strong>{selectedTemplate.name}</strong></div>
                <div className="summary-item"><span>Market</span><strong>{config.symbol}</strong></div>
                <div className="summary-item"><span>Contract</span><strong>{config.contract_type?.replace("DIGIT", "")}</strong></div>
                {config.barrier && <div className="summary-item"><span>Digit</span><strong>#{config.barrier}</strong></div>}
                <div className="summary-item"><span>Base Stake</span><strong>${fmt(config.stake ?? 0)}</strong></div>
                <div className="summary-item"><span>Duration</span><strong>{config.duration_ticks} ticks</strong></div>
                {(config.strategy === "martingale" || config.strategy === "anti_martingale") && (
                  <div className="summary-item"><span>Multiplier</span><strong>{config.martingale_multiplier}x</strong></div>
                )}
                {config.max_stake && <div className="summary-item"><span>Max Stake</span><strong>${fmt(config.max_stake)}</strong></div>}
                {config.take_profit && <div className="summary-item"><span>Take Profit</span><strong className="positive">+${fmt(config.take_profit)}</strong></div>}
                {config.stop_loss && <div className="summary-item"><span>Stop Loss</span><strong className="negative">-${fmt(config.stop_loss)}</strong></div>}
                <div className="summary-item"><span>Max Trades</span><strong>{config.max_trades}</strong></div>
                {config.dryRun && <div className="summary-item"><span>Mode</span><strong className="dry-run-badge">DRY RUN</strong></div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== RUNNER ===== */}
      {view === "runner" && activeBot && (
        <BotRunner
          bot={activeBot}
          onStop={() => stopBot(activeBot.config.id)}
          onPause={() => pauseBot(activeBot.config.id)}
          onResume={() => resumeBot(activeBot.config.id)}
          onBack={() => setView("templates")}
          fmt={fmt}
          fmtDuration={fmtDuration}
        />
      )}

      {/* ===== VISUAL BLOCKLY EDITOR ===== */}
      {view === "visual" && (
        <VisualBlocklyEditor
          visualCode={visualCode}
          setVisualCode={setVisualCode}
          onBack={() => setView("templates")}
          tradingAdapter={tradingAdapter}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bot Card                                                           */
/* ------------------------------------------------------------------ */

function BotCard({
  bot, onStart, onStop, onPause, onResume, onDelete, onSelect, fmt,
}: {
  bot: BotState;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onSelect: () => void;
  fmt: (n: number) => string;
}) {
  const statusColors: Record<string, string> = {
    idle: "#718197",
    running: "#37d4bd",
    paused: "#f0c040",
    stopped: "#f08080",
    completed: "#8de7d9",
  };

  return (
    <div className={`bot-card ${bot.status}`} onClick={onSelect}>
      <div className="bot-card-header">
        <span className="bot-card-status" style={{ background: statusColors[bot.status] ?? "#718197" }} />
        <span className="bot-card-name">{bot.config.name}</span>
        {bot.config.dryRun && <span className="bot-card-badge dryrun">DRY RUN</span>}
        <span className={`bot-card-badge ${bot.status}`}>{bot.status.toUpperCase()}</span>
      </div>
      <div className="bot-card-stats">
        <div><span>P&L</span><strong className={bot.totalProfit >= 0 ? "positive" : "negative"}>{bot.totalProfit >= 0 ? "+" : ""}${fmt(bot.totalProfit)}</strong></div>
        <div><span>Trades</span><strong>{bot.totalTrades}</strong></div>
        <div><span>W/L</span><strong>{bot.wins}/{bot.losses}</strong></div>
      </div>
      <div className="bot-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="bot-action-btn export" title="Export as Deriv Bot XML" onClick={() => downloadBotXml(bot.config)}><IconDownload size={14} /></button>
        {(bot.status === "idle" || bot.status === "stopped") && <button className="bot-action-btn start" onClick={onStart}>▶ Start</button>}
        {bot.status === "running" && <button className="bot-action-btn pause" onClick={onPause}>⏸ Pause</button>}
        {bot.status === "paused" && <button className="bot-action-btn start" onClick={onResume}>▶ Resume</button>}
        {(bot.status === "running" || bot.status === "paused") && <button className="bot-action-btn stop" onClick={onStop}>⏹ Stop</button>}
        {bot.status === "stopped" && <button className="bot-action-btn delete" onClick={onDelete}><IconTrash size={14} /> Delete</button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bot Runner                                                         */
/* ------------------------------------------------------------------ */

function BotRunner({
  bot, onStop, onPause, onResume, onBack, fmt, fmtDuration,
}: {
  bot: BotState;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onBack: () => void;
  fmt: (n: number) => string;
  fmtDuration: (ms: number) => string;
}) {
  const elapsed = bot.startTime ? Date.now() - bot.startTime : 0;

  return (
    <div className="bot-runner-view">
      <div className="bot-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div>
          <p className="eyebrow">BOT RUNNING{bot.config.dryRun ? ' — DRY RUN' : ''}</p>
          <h1>{bot.config.name}</h1>
        </div>
      </div>

      {/* Status bar */}
      <div className={`runner-status ${bot.status}`}>
        <div className="runner-status-dot" />
        <span>{bot.status.toUpperCase()}</span>
        {bot.error && <span className="runner-error">{bot.error}</span>}
      </div>

      {/* Live stats */}
      <div className="runner-stats">
        <div className="runner-stat">
          <span>Total P&L</span>
          <strong className={`runner-profit ${bot.totalProfit >= 0 ? "positive" : "negative"}`}>
            {bot.totalProfit >= 0 ? "+" : ""}${fmt(bot.totalProfit)}
          </strong>
        </div>
        <div className="runner-stat">
          <span>Trades</span>
          <strong>{bot.totalTrades}/{bot.config.max_trades ?? "∞"}</strong>
        </div>
        <div className="runner-stat">
          <span>Win Rate</span>
          <strong>{bot.totalTrades > 0 ? ((bot.wins / bot.totalTrades) * 100).toFixed(1) : "0.0"}%</strong>
        </div>
        <div className="runner-stat">
          <span>W / L</span>
          <strong><span className="win-count">{bot.wins}</span> / <span className="loss-count">{bot.losses}</span></strong>
        </div>
        <div className="runner-stat">
          <span>Current Stake</span>
          <strong>${fmt(bot.currentStake)}</strong>
        </div>
        <div className="runner-stat">
          <span>Last</span>
          <strong className={bot.lastTradeResult === "won" ? "positive" : bot.lastTradeResult === "lost" ? "negative" : ""}>
            {bot.lastTradeResult === "won" ? "✓ WIN" : bot.lastTradeResult === "lost" ? "✗ LOSS" : "—"}
          </strong>
        </div>
      </div>

      {/* Controls */}
      <div className="runner-controls">
        {bot.status === "running" && (
          <button className="runner-btn pause" onClick={onPause}>⏸ Pause</button>
        )}
        {bot.status === "paused" && (
          <button className="runner-btn resume" onClick={onResume}>▶ Resume</button>
        )}
        {(bot.status === "running" || bot.status === "paused") && (
          <button className="runner-btn stop" onClick={onStop}>⏹ Stop Bot</button>
        )}
      </div>

      {/* Trade log */}
      <div className="runner-log">
        <h3>Trade Log</h3>
        <div className="runner-log-list">
          {bot.trades.length === 0 ? (
            <p className="muted">Waiting for first trade…</p>
          ) : (
            [...bot.trades].reverse().map((trade) => (
              <div key={trade.id} className={`runner-log-entry ${trade.status}`}>
                <span className="log-time">{new Date(trade.timestamp).toLocaleTimeString()}</span>
                <span className="log-type">{trade.contract_type.replace("DIGIT", "")}</span>
                <span className="log-stake">${fmt(trade.stake)}</span>
                <span className={`log-profit ${trade.profit >= 0 ? "positive" : "negative"}`}>
                  {trade.profit >= 0 ? "+" : ""}${fmt(trade.profit)}
                </span>
                <span className={`log-result ${trade.status}`}>{trade.status === "won" ? "✓" : "✗"}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

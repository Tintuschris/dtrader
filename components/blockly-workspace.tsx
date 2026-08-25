"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Blockly from "blockly/core";
import "blockly/blocks";
import "blockly/javascript";
import { DTRADER_TOOLBOX, DEFAULT_WORKSPACE_XML } from "../lib/blockly-toolbox";
import { registerDTraderGenerator, generateBotCode } from "../lib/blockly-generator";
import { registerAllBlocks } from "../lib/blockly-blocks";

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

type Props = {
  onCodeGenerated: (code: string) => void;
  initialXml?: string;
};

/* ------------------------------------------------------------------ */
/*  Workspace Component                                                 */
/* ------------------------------------------------------------------ */

export default function BlocklyWorkspace({
  onCodeGenerated,
  initialXml,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const [isReady, setIsReady] = useState(false);

  /* ---- initialize Blockly workspace ---- */
  useEffect(() => {
    if (!containerRef.current || workspaceRef.current) return;

    // Register custom blocks and generator (idempotent)
    registerAllBlocks();
    registerDTraderGenerator();

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

    // Listen for changes and generate code
    ws.addChangeListener(() => {
      try {
        const code = generateBotCode(ws);
        onCodeGenerated(code);
      } catch {
        // Ignore generation errors during editing
      }
    });

    setIsReady(true);

    return () => {
      ws.dispose();
      workspaceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- export / import helpers ---- */
  const getXml = useCallback(() => {
    if (!workspaceRef.current) return "";
    const dom = Blockly.Xml.workspaceToDom(workspaceRef.current);
    return Blockly.Xml.domToText(dom);
  }, []);

  const loadXml = useCallback((xml: string) => {
    if (!workspaceRef.current) return;
    try {
      const dom = Blockly.utils.xml.textToDom(xml);
      workspaceRef.current.clear();
      Blockly.Xml.domToWorkspace(dom, workspaceRef.current);
    } catch {
      console.error("Failed to load XML into workspace");
    }
  }, []);

  const clearWorkspace = useCallback(() => {
    workspaceRef.current?.clear();
    // Re-load defaults
    try {
      const dom = Blockly.utils.xml.textToDom(DEFAULT_WORKSPACE_XML);
      Blockly.Xml.domToWorkspace(dom, workspaceRef.current!);
    } catch { /* ignore */ }
  }, []);

  const getCode = useCallback(() => {
    if (!workspaceRef.current) return "";
    return generateBotCode(workspaceRef.current);
  }, []);

  /* ---- expose methods via ref-like pattern using window ---- */
  useEffect(() => {
    if (!workspaceRef.current) return;
    const w = workspaceRef.current as unknown as Record<string, unknown>;
    w.__getXml = getXml;
    w.__loadXml = loadXml;
    w.__getCode = getCode;
    w.__clear = clearWorkspace;
  }, [isReady, getXml, loadXml, getCode, clearWorkspace]);

  return (
    <div className="blockly-wrapper">
      <div ref={containerRef} className="blockly-container" />
      <style jsx>{`
        .blockly-wrapper {
          width: 100%;
          height: 100%;
          position: relative;
          border-radius: 10px;
          overflow: hidden;
          background: #1a1a2e;
        }
        .blockly-container {
          width: 100%;
          height: 100%;
          min-height: 500px;
        }
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

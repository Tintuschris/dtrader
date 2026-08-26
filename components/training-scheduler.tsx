"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { IconClock, IconPlayerPlay, IconPlayerStop, IconRefresh } from "@tabler/icons-react";

type ScheduleConfig = {
  enabled: boolean;
  intervalMinutes: number;
  maxRetrainsPerDay: number;
  minBufferSize: number;
  autoStopOnPlateau: boolean;
  plateauPatience: number;
  preferredTime: string; // HH:MM format
};

type Props = {
  bufferSize: number;
  modelStatus: string;
  onTrainNow: () => void;
  lastTrainedAt: number;
};

const DEFAULT_CONFIG: ScheduleConfig = {
  enabled: false,
  intervalMinutes: 30,
  maxRetrainsPerDay: 10,
  minBufferSize: 200,
  autoStopOnPlateau: true,
  plateauPatience: 3,
  preferredTime: "00:00",
};

export default function TrainingScheduler({ bufferSize, modelStatus, onTrainNow, lastTrainedAt }: Props) {
  const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_CONFIG);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<number>(0);
  const [retrainsToday, setRetrainsToday] = useState(0);
  const [nextRunIn, setNextRunIn] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset daily counter at midnight
  useEffect(() => {
    const check = () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        setRetrainsToday(0);
      }
    };
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);

  // Main scheduling timer
  useEffect(() => {
    if (!config.enabled || !isRunning) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      setNextRunIn(0);
      return;
    }

    const intervalMs = config.intervalMinutes * 60 * 1000;
    let nextRun = Date.now() + intervalMs;
    setNextRunIn(Math.ceil(intervalMs / 1000));

    timerRef.current = setInterval(() => {
      // Check conditions before training
      if (bufferSize >= config.minBufferSize && retrainsToday < config.maxRetrainsPerDay) {
        onTrainNow();
        setLastRun(Date.now());
        setRetrainsToday((c) => c + 1);
        nextRun = Date.now() + intervalMs;
      }
    }, intervalMs);

    // Countdown timer
    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextRun - Date.now()) / 1000));
      setNextRunIn(remaining);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [config, isRunning, bufferSize, retrainsToday, onTrainNow]);

  const toggleSchedule = useCallback(() => {
    setIsRunning((r) => !r);
  }, []);

  const formatCountdown = (seconds: number): string => {
    if (seconds <= 0) return "Now";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="ts">
      <div className="ts-header">
        <div>
          <h3>⏰ Training Scheduler</h3>
          <p className="ts-subtitle">Configure automatic retraining schedule</p>
        </div>
        <button className={`ts-toggle ${isRunning ? "running" : ""}`} onClick={toggleSchedule}>
          {isRunning ? <><IconPlayerStop size={14} /> Stop</> : <><IconPlayerPlay size={14} /> Start</>}
        </button>
      </div>

      {/* Status bar */}
      {isRunning && (
        <div className="ts-status">
          <div className="ts-status-item">
            <IconClock size={14} />
            <span>Next: {formatCountdown(nextRunIn)}</span>
          </div>
          <div className="ts-status-item">
            <span>Retrains today: {retrainsToday}/{config.maxRetrainsPerDay}</span>
          </div>
          {lastRun > 0 && (
            <div className="ts-status-item">
              <span>Last: {new Date(lastRun).toLocaleTimeString()}</span>
            </div>
          )}
        </div>
      )}

      {/* Config grid */}
      <div className="ts-config">
        <div className="ts-field">
          <label>Interval (minutes)</label>
          <input
            type="number"
            min={5}
            max={1440}
            value={config.intervalMinutes}
            onChange={(e) => setConfig((c) => ({ ...c, intervalMinutes: parseInt(e.target.value) || 30 }))}
          />
        </div>
        <div className="ts-field">
          <label>Max retrains/day</label>
          <input
            type="number"
            min={1}
            max={100}
            value={config.maxRetrainsPerDay}
            onChange={(e) => setConfig((c) => ({ ...c, maxRetrainsPerDay: parseInt(e.target.value) || 10 }))}
          />
        </div>
        <div className="ts-field">
          <label>Min buffer size</label>
          <input
            type="number"
            min={50}
            max={10000}
            value={config.minBufferSize}
            onChange={(e) => setConfig((c) => ({ ...c, minBufferSize: parseInt(e.target.value) || 200 }))}
          />
          <span className="ts-hint">Current: {bufferSize.toLocaleString()}</span>
        </div>
        <div className="ts-field">
          <label>Plateau patience (epochs)</label>
          <input
            type="number"
            min={1}
            max={20}
            value={config.plateauPatience}
            onChange={(e) => setConfig((c) => ({ ...c, plateauPatience: parseInt(e.target.value) || 3 }))}
          />
        </div>
      </div>

      {/* Toggles */}
      <div className="ts-toggles">
        <label className="ts-toggle-label">
          <input
            type="checkbox"
            checked={config.autoStopOnPlateau}
            onChange={(e) => setConfig((c) => ({ ...c, autoStopOnPlateau: e.target.checked }))}
          />
          <span>Auto-stop on plateau</span>
        </label>
      </div>

      {/* Current model info */}
      <div className="ts-info">
        <div className="ts-info-item">
          <span className="ts-info-label">Model Status</span>
          <span className="ts-info-val">{modelStatus}</span>
        </div>
        <div className="ts-info-item">
          <span className="ts-info-label">Buffer</span>
          <span className={`ts-info-val ${bufferSize >= config.minBufferSize ? "good" : "bad"}`}>
            {bufferSize.toLocaleString()}/{config.minBufferSize.toLocaleString()}
          </span>
        </div>
        {lastTrainedAt > 0 && (
          <div className="ts-info-item">
            <span className="ts-info-label">Last Trained</span>
            <span className="ts-info-val">{new Date(lastTrainedAt).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      <style jsx>{`
        .ts { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 10px; }
        .ts-header { display: flex; justify-content: space-between; align-items: center; }
        .ts-header h3 { margin: 0; font-size: 15px; }
        .ts-subtitle { font-size: 12px; color: #566477; margin: 0; }

        .ts-toggle {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 8px; font-size: 12px;
          font-weight: 600; cursor: pointer; transition: 0.15s; border: none;
          background: rgba(55,212,189,.12); color: #37d4bd; border: 1px solid rgba(55,212,189,.3);
        }
        .ts-toggle.running { background: rgba(224,85,85,.12); color: #e05555; border-color: rgba(224,85,85,.3); }
        .ts-toggle:hover { filter: brightness(1.2); }

        .ts-status {
          display: flex; gap: 16px; padding: 8px 12px;
          background: rgba(154,142,210,.06); border-radius: 8px;
          font-size: 12px; color: #9a8ed2; flex-wrap: wrap;
        }
        .ts-status-item { display: flex; align-items: center; gap: 6px; }

        .ts-config {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;
        }
        .ts-field { display: flex; flex-direction: column; gap: 4px; }
        .ts-field label { font-size: 11px; color: #718197; text-transform: uppercase; }
        .ts-field input {
          padding: 6px 10px; background: #1a2332;
          border: 1px solid var(--border, #2a3444); border-radius: 6px;
          color: #d9e3ed; font-size: 13px; font-family: monospace;
        }
        .ts-field input:focus { outline: none; border-color: #9a8ed2; }
        .ts-hint { font-size: 10px; color: #566477; }

        .ts-toggles { display: flex; gap: 16px; flex-wrap: wrap; }
        .ts-toggle-label {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: #d9e3ed; cursor: pointer;
        }
        .ts-toggle-label input { accent-color: #9a8ed2; }

        .ts-info {
          display: flex; gap: 16px; padding: 8px 12px;
          background: rgba(255,255,255,.02); border-radius: 8px;
          flex-wrap: wrap;
        }
        .ts-info-item { display: flex; flex-direction: column; gap: 2px; }
        .ts-info-label { font-size: 9px; color: #566477; text-transform: uppercase; }
        .ts-info-val { font-size: 12px; font-weight: 600; color: #d9e3ed; font-family: monospace; }
        .ts-info-val.good { color: #37d4bd; }
        .ts-info-val.bad { color: #e05555; }
      `}</style>
    </div>
  );
}

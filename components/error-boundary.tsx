"use client";

import { Component, type ReactNode } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ""}]`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 40,
          textAlign: "center",
          color: "var(--muted, #8b9aad)",
        }}>
          <IconAlertTriangle size={32} color="#f59e0b" />
          <h3 style={{ margin: 0, color: "var(--text, #f4f7fb)", fontSize: 16 }}>
            Something went wrong
          </h3>
          <p style={{ margin: 0, fontSize: 13, maxWidth: 400 }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              background: "rgba(70,211,189,.1)",
              border: "1px solid rgba(70,211,189,.3)",
              color: "#8de7d9",
              borderRadius: 7,
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

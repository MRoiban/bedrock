import { Component, type ReactNode } from "react";
import type { Client } from "../client";
export class ErrorBoundary extends Component<{ client: Pick<Client, "captureException">; fallback: ReactNode; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.client.captureException(error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

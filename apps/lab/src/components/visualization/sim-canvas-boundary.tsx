'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { LocalErrorPanel } from '@/components/visualization/local-error-panel';
import { classifyGpuFailure } from '@/lib/lab-diagnostics';

/**
 * Local error boundary for the flow-field canvas / WebGPU path.
 * Catches render-time throws so a single model/sim failure cannot escalate
 * to the Next.js whole-page "This page couldn't load" boundary.
 */
export class SimCanvasBoundary extends Component<
  {
    children: ReactNode;
    /** Change when model or reset changes so a prior error can clear. */
    resetKey: string;
    onReset?: () => void;
  },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('流场画布渲染失败', error, info.componentStack);
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const classified = classifyGpuFailure(this.state.error.message);
    return (
      <LocalErrorPanel
        title="流场画布失败，实验室其余功能仍可使用"
        message={classified.message}
        code={classified.code}
        dataAttr="boundary"
        primaryLabel="清除错误并重试"
        onPrimary={() => {
          this.props.onReset?.();
          this.setState({ error: null });
        }}
      />
    );
  }
}

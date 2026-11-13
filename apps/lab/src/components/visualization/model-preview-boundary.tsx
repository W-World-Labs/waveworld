'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { LocalErrorPanel } from '@/components/visualization/local-error-panel';
import { classifyGpuFailure } from '@/lib/lab-diagnostics';

export class ModelPreviewBoundary extends Component<{
  children: ReactNode;
  resetKey: string;
  onUnload: () => void;
}, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('模型预览渲染失败', error, info.componentStack);
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const classified = classifyGpuFailure(this.state.error.message);
    return (
      <LocalErrorPanel
        title="模型预览失败，实验室其余功能仍可使用"
        message={classified.message}
        code={classified.code === 'gpu_unknown' ? 'preview_error' : classified.code}
        dataAttr="preview-boundary"
        primaryLabel="卸载此模型并重试"
        onPrimary={() => {
          this.props.onUnload();
          this.setState({ error: null });
        }}
      />
    );
  }
}

import { icons } from "./icons";
import { Component, type ReactNode } from "react";
import { Alert } from "./feedback";
import { Button } from "./controls";
import { Page, Row } from "./layout";

/** Keeps one broken screen from taking the whole shell down. Reset by changing `resetKey` (the route). */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: Error | null; key: string }> {
  state = { failed: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(failed: Error) {
    return { failed };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: Error | null; key: string }) {
    return props.resetKey !== state.key ? { failed: null, key: props.resetKey } : null;
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Page>
        <Alert tone="danger" role="alert" title="This screen could not be shown">
          Something unexpected happened while drawing it. Your data is not affected. {this.state.failed.message}
        </Alert>
        <Row><Button onClick={() => location.reload()} icon={icons.reset}>Reload</Button><Button to="/" icon={icons.arrowLeft}>Back to the library</Button></Row>
      </Page>
    );
  }
}

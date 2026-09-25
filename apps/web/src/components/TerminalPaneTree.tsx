import { Fragment, type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { useResizeDrag } from "~/hooks/useResizeDrag";
import { cn } from "~/lib/utils";
import {
  layoutTerminalIds,
  resizeSplitSizes,
  splitSizes,
  type TerminalPaneLayout,
  type TerminalPaneLayoutPath,
  type TerminalSplitDirection,
} from "../terminalPaneLayout";

/** A terminal smaller than this is useless; both neighbours of a drag are clamped to it. */
export const TERMINAL_PANE_MIN_PX = 64;
const TERMINAL_DIVIDER_PX = 1;

/** e.g. "minmax(0, 0.62fr) 1px minmax(0, 0.38fr)". */
export function splitGridTemplate(sizes: readonly number[], dividerPx: number): string {
  const tracks: string[] = [];
  sizes.forEach((size, index) => {
    if (index > 0) tracks.push(`${dividerPx}px`);
    tracks.push(`minmax(0, ${size}fr)`);
  });
  return tracks.join(" ");
}

interface TerminalPaneTreeProps {
  layout: TerminalPaneLayout;
  activeTerminalId: string;
  renderPane: (terminalId: string) => ReactNode;
  /** Absent: dividers render as inert 1px lines with no drag handling. */
  onPaneSizesChange?:
    | ((path: TerminalPaneLayoutPath, sizes: number[] | undefined) => void)
    | undefined;
  /** Called once per completed drag so the owner can refit terminals. */
  onResizeCommit?: (() => void) | undefined;
}

/** Renders a split-pane tree: a leaf is one terminal, a split lays out its children in a resizable grid. */
export function TerminalPaneTree(props: TerminalPaneTreeProps) {
  return <TerminalPaneNode {...props} path={[]} />;
}

interface TerminalPaneNodeProps extends TerminalPaneTreeProps {
  path: TerminalPaneLayoutPath;
}

function TerminalPaneNode({
  layout,
  path,
  activeTerminalId,
  renderPane,
  onPaneSizesChange,
  onResizeCommit,
}: TerminalPaneNodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  if (layout.kind === "pane") {
    return <>{renderPane(layout.terminalId)}</>;
  }
  const sizes = splitSizes(layout);
  const template = splitGridTemplate(sizes, TERMINAL_DIVIDER_PX);
  return (
    <div
      ref={containerRef}
      className="grid h-full w-full min-w-0 gap-0 overflow-hidden"
      style={
        layout.direction === "vertical"
          ? { gridTemplateRows: template }
          : { gridTemplateColumns: template }
      }
    >
      {layout.children.map((child, index) => {
        const isActiveBranch = layoutTerminalIds(child).includes(activeTerminalId);
        return (
          <Fragment key={child.kind === "pane" ? child.terminalId : `split-${index}`}>
            {index > 0 ? (
              <TerminalSplitDivider
                direction={layout.direction}
                index={index - 1}
                sizes={sizes}
                containerRef={containerRef}
                active={
                  isActiveBranch ||
                  layoutTerminalIds(layout.children[index - 1]!).includes(activeTerminalId)
                }
                onCommit={(nextSizes) => {
                  onPaneSizesChange?.(path, nextSizes);
                  onResizeCommit?.();
                }}
              />
            ) : null}
            <div className="min-h-0 min-w-0">
              <TerminalPaneNode
                layout={child}
                path={[...path, index]}
                activeTerminalId={activeTerminalId}
                renderPane={renderPane}
                onPaneSizesChange={onPaneSizesChange}
                onResizeCommit={onResizeCommit}
              />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

interface TerminalSplitDividerProps {
  readonly direction: TerminalSplitDirection;
  /** Divider between sizes[index] and sizes[index + 1]. */
  readonly index: number;
  readonly sizes: readonly number[];
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly active: boolean;
  readonly onCommit: (sizes: number[] | undefined) => void;
}

function TerminalSplitDivider({
  direction,
  index,
  sizes,
  containerRef,
  active,
  onCommit,
}: TerminalSplitDividerProps) {
  const axis = direction === "vertical" ? "y" : "x";
  const latestSizes = useRef(sizes);
  useLayoutEffect(() => {
    latestSizes.current = sizes;
  }, [sizes]);

  const handlers = useResizeDrag<HTMLDivElement>(() => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const axisLengthPx = axis === "y" ? rect.height : rect.width;
    const startSizes = latestSizes.current;
    const dividerCount = startSizes.length - 1;
    const availablePx = axisLengthPx - dividerCount * TERMINAL_DIVIDER_PX;
    if (!Number.isFinite(availablePx) || availablePx <= 0) return null;

    const startWidthPx = startSizes[index]! * availablePx;
    let latestResult: number[] | null = null;

    return {
      width: startWidthPx,
      edge: "right",
      axis,
      resize(px) {
        const nextSizes = resizeSplitSizes({
          sizes: startSizes,
          index,
          availablePx,
          deltaPx: px - startWidthPx,
          minPanePx: TERMINAL_PANE_MIN_PX,
        });
        if (nextSizes === startSizes) return startWidthPx;
        latestResult = nextSizes as number[];
        container.style.setProperty(
          axis === "y" ? "grid-template-rows" : "grid-template-columns",
          splitGridTemplate(nextSizes, TERMINAL_DIVIDER_PX),
        );
        return nextSizes[index]! * availablePx;
      },
      finish(_px, moved) {
        if (!moved || latestResult === null) return;
        onCommit(latestResult);
      },
    };
  });

  return (
    <div
      role="separator"
      aria-orientation={direction === "vertical" ? "horizontal" : "vertical"}
      className={cn(
        "group relative z-10 touch-none select-none",
        axis === "x" ? "cursor-col-resize" : "cursor-row-resize",
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute transition-colors duration-150",
          axis === "x"
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
          active ? "bg-border" : "bg-border/70",
          "group-hover:bg-border group-active:bg-primary/60",
        )}
      />
      <div
        aria-hidden
        className={cn("absolute", axis === "x" ? "-inset-x-1 inset-y-0" : "-inset-y-1 inset-x-0")}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";

/** Связь со крестиком удаления при наведении. */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const showDelete = hovered || selected;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: hovered || selected ? 2.5 : 1.75,
          stroke: hovered || selected ? "#18181b" : "#a1a1aa",
        }}
        interactionWidth={28}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            zIndex: 1000,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Невидимая зона наведения над линией */}
          <div className="flex h-8 w-8 items-center justify-center">
            {showDelete ? (
              <button
                type="button"
                title="Удалить связь"
                aria-label="Удалить связь"
                className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 bg-white text-sm leading-none text-zinc-700 shadow-sm hover:border-red-400 hover:bg-red-50 hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  setEdges((edges) => edges.filter((edge) => edge.id !== id));
                }}
              >
                ×
              </button>
            ) : (
              <span className="h-3 w-3 rounded-full bg-transparent" />
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = {
  deletable: DeletableEdge,
};

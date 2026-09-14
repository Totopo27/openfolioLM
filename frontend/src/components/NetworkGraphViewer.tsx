import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  Share2,
  Sliders,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Info,
} from 'lucide-react';
import { NetworkGraph, GraphNode, GraphRole } from '../types';
import { fetchProjectNetwork } from '../services/api';

interface NetworkGraphViewerProps {
  projectId: string;
  selectedDocId?: string | null;
  onSelectDocument: (docId: string) => void;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

const ROLE_COLORS: Record<GraphRole, { fill: string; stroke: string; label: string; icon: string }> = {
  foundation: { fill: '#f59e0b', stroke: '#fbbf24', label: 'Fundacional / Landmark', icon: 'Award' },
  frontier: { fill: '#10b981', stroke: '#34d399', label: 'Frontera SOTA (Reciente)', icon: 'Zap' },
  bridge: { fill: '#8b5cf6', stroke: '#a78bfa', label: 'Puente Interdisciplinario', icon: 'GitMerge' },
  corpus: { fill: '#3b82f6', stroke: '#60a5fa', label: 'Literatura de Corpus', icon: 'BookOpen' },
};

export const NetworkGraphViewer: React.FC<NetworkGraphViewerProps> = ({
  projectId,
  selectedDocId,
  onSelectDocument,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graphData, setGraphData] = useState<NetworkGraph | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Controls
  const [minSimilarity, setMinSimilarity] = useState<number>(0.65);
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState({
    citation: true,
    semantic_similarity: true,
    co_authorship: true,
  });
  const [visibleRoles, setVisibleRoles] = useState<Record<GraphRole, boolean>>({
    foundation: true,
    frontier: true,
    bridge: true,
    corpus: true,
  });

  // Camera State (Zoom & Pan)
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  // Dragging & Hovering
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Simulation Nodes ref
  const simNodesRef = useRef<SimNode[]>([]);

  useEffect(() => {
    loadGraph();
  }, [projectId, minSimilarity]);

  const loadGraph = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchProjectNetwork(projectId, minSimilarity);
      setGraphData(data);

      // Initialize simulation positions
      const canvas = canvasRef.current;
      const width = canvas ? canvas.width : 700;
      const height = canvas ? canvas.height : 600;
      const cx = width / 2;
      const cy = height / 2;

      simNodesRef.current = data.nodes.map((node, i) => {
        const angle = (i / Math.max(1, data.nodes.length)) * 2 * Math.PI;
        const dist = 120 + Math.random() * 100;
        const radius =
          node.role === 'foundation' ? 20 : node.role === 'bridge' ? 17 : node.role === 'frontier' ? 16 : 13;

        return {
          ...node,
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          vx: 0,
          vy: 0,
          radius,
        };
      });
    } catch (err) {
      console.error('Failed to load network graph:', err);
      setError('Error al calcular el grafo semántico del proyecto.');
    } finally {
      setIsLoading(false);
    }
  };

  // Filtered edges
  const filteredEdges = useMemo(() => {
    if (!graphData) return [];
    return graphData.edges.filter((edge) => {
      if (!visibleEdgeTypes[edge.type]) return false;
      const sourceNode = simNodesRef.current.find((n) => n.id === edge.source);
      const targetNode = simNodesRef.current.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) return false;
      if (!visibleRoles[sourceNode.role as GraphRole] || !visibleRoles[targetNode.role as GraphRole]) {
        return false;
      }
      return true;
    });
  }, [graphData, visibleEdgeTypes, visibleRoles]);

  // Canvas render & physics loop
  useEffect(() => {
    let animationFrameId: number;

    const runSimulationStep = () => {
      const nodes = simNodesRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      // 1. Coulomb Repulsion
      const kRep = 3500;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);
          if (dist < 350) {
            const force = kRep / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
          }
        }
      }

      // 2. Spring Attraction along Edges
      const kSpring = 0.035;
      const desiredLength = 130;
      for (const edge of filteredEdges) {
        const s = nodes.find((n) => n.id === edge.source);
        const t = nodes.find((n) => n.id === edge.target);
        if (s && t) {
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const displacement = dist - desiredLength;
          const force = displacement * kSpring * edge.weight;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          s.vx += fx;
          s.vy += fy;
          t.vx -= fx;
          t.vy -= fy;
        }
      }

      // 3. Center Gravity & Integration
      const kGrav = 0.012;
      const friction = 0.85;

      for (const node of nodes) {
        if (node.id === draggedNodeId) {
          // Keep velocity zero when dragged
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx += (cx - node.x) * kGrav;
        node.vy += (cy - node.y) * kGrav;
        node.vx *= friction;
        node.vy *= friction;

        node.x += node.vx;
        node.y += node.vy;
      }
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Match canvas resolution to device pixel ratio
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply Zoom & Pan transforms
      ctx.scale(dpr * scale, dpr * scale);
      ctx.translate(offset.x, offset.y);

      const nodes = simNodesRef.current;

      // Draw Edges
      for (const edge of filteredEdges) {
        const s = nodes.find((n) => n.id === edge.source);
        const t = nodes.find((n) => n.id === edge.target);
        if (!s || !t) continue;

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);

        if (edge.type === 'citation') {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)'; // slate-400
          ctx.lineWidth = 1.8;
          ctx.setLineDash([]);
        } else if (edge.type === 'co_authorship') {
          ctx.strokeStyle = 'rgba(244, 114, 182, 0.6)'; // pink-400
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
        } else {
          // semantic similarity
          const alpha = Math.max(0.2, edge.weight * 0.75);
          ctx.strokeStyle = `rgba(99, 102, 241, ${alpha})`; // indigo-500
          ctx.lineWidth = Math.max(1, edge.weight * 3);
          ctx.setLineDash([]);
        }
        ctx.stroke();

        // Draw directed arrow for citations
        if (edge.type === 'citation') {
          const angle = Math.atan2(t.y - s.y, t.x - s.x);
          const arrowLen = 9;
          const arrowX = t.x - Math.cos(angle) * (t.radius + 3);
          const arrowY = t.y - Math.sin(angle) * (t.radius + 3);

          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY);
          ctx.lineTo(
            arrowX - arrowLen * Math.cos(angle - Math.PI / 6),
            arrowY - arrowLen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            arrowX - arrowLen * Math.cos(angle + Math.PI / 6),
            arrowY - arrowLen * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
          ctx.fill();
        }
      }
      ctx.setLineDash([]);

      // Draw Nodes
      for (const node of nodes) {
        if (!visibleRoles[node.role as GraphRole]) continue;

        const roleConfig = ROLE_COLORS[node.role as GraphRole] || ROLE_COLORS.corpus;
        const isSelected = selectedDocId === node.id;
        const isHovered = hoveredNode?.id === node.id;

        // Outer glow on selected or hovered
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 6, 0, 2 * Math.PI);
          ctx.fillStyle = isSelected ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.2)';
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI);
        ctx.fillStyle = roleConfig.fill;
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#ffffff' : roleConfig.stroke;
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.stroke();

        // Node Label
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = isSelected ? '#ffffff' : '#cbd5e1';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.label, node.x, node.y + node.radius + 4);
      }

      ctx.restore();
    };

    const loop = () => {
      runSimulationStep();
      draw();
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [filteredEdges, visibleRoles, scale, offset, draggedNodeId, hoveredNode, selectedDocId]);

  // Coordinate conversion helper
  const getCanvasMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const worldX = clientX / scale - offset.x;
    const worldY = clientY / scale - offset.y;
    return { x: worldX, y: worldY };
  };

  const findNodeAtPos = (pos: { x: number; y: number }): SimNode | null => {
    for (const node of simNodesRef.current) {
      if (!visibleRoles[node.role as GraphRole]) continue;
      const dx = node.x - pos.x;
      const dy = node.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) {
        return node;
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasMousePos(e);
    const node = findNodeAtPos(pos);

    if (node) {
      setDraggedNodeId(node.id);
    } else {
      setIsPanning(true);
      setStartPan({ x: e.clientX - offset.x * scale, y: e.clientY - offset.y * scale });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasMousePos(e);
    setMousePos({ x: e.clientX, y: e.clientY });

    if (draggedNodeId) {
      const node = simNodesRef.current.find((n) => n.id === draggedNodeId);
      if (node) {
        node.x = pos.x;
        node.y = pos.y;
      }
    } else if (isPanning) {
      setOffset({
        x: (e.clientX - startPan.x) / scale,
        y: (e.clientY - startPan.y) / scale,
      });
    } else {
      const node = findNodeAtPos(pos);
      setHoveredNode(node);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggedNodeId) {
      const pos = getCanvasMousePos(e);
      const node = findNodeAtPos(pos);
      if (node && node.id === draggedNodeId) {
        onSelectDocument(node.id);
      }
      setDraggedNodeId(null);
    }
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setScale((prev) => Math.min(2.5, Math.max(0.4, prev * zoomFactor)));
  };

  const handleResetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    loadGraph();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden relative select-none">
      {/* Top Controls & Metrics Bar */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between gap-4 flex-wrap z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <Share2 className="w-4 h-4 text-indigo-400" />
            <span>Red Semántica & Co-citaciones</span>
          </div>

          {/* Metrics Pills */}
          {graphData && (
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400 font-mono">
              <span className="bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700/60">
                {graphData.metrics.node_count} nodos
              </span>
              <span className="bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700/60">
                {filteredEdges.length} aristas
              </span>
              <span className="bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700/60">
                densidad: {graphData.metrics.density}
              </span>
            </div>
          )}
        </div>

        {/* View Tools & Sliders */}
        <div className="flex items-center gap-3">
          {/* Similarity threshold slider */}
          <div className="flex items-center gap-2 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] text-slate-400 font-mono">Similitud min:</span>
            <input
              type="range"
              min="0.50"
              max="0.90"
              step="0.05"
              value={minSimilarity}
              onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
              className="w-16 accent-indigo-500 cursor-pointer"
            />
            <span className="text-[11px] text-indigo-300 font-mono font-medium">
              {Math.round(minSimilarity * 100)}%
            </span>
          </div>

          {/* Zoom buttons */}
          <div className="flex items-center bg-slate-900 rounded-lg border border-slate-800 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.5, s * 1.15))}
              className="p-1.5 text-slate-400 hover:text-white rounded transition cursor-pointer"
              title="Acercar"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.4, s * 0.85))}
              className="p-1.5 text-slate-400 hover:text-white rounded transition cursor-pointer"
              title="Alejar"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              className="p-1.5 text-slate-400 hover:text-white rounded transition cursor-pointer"
              title="Restablecer vista"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Legend & Filter Badges */}
      <div className="px-4 py-2 border-b border-slate-900 bg-slate-950/80 flex items-center justify-between text-[11px] gap-2 flex-wrap z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-500 font-medium mr-1">Roles:</span>
          {(['foundation', 'frontier', 'bridge', 'corpus'] as GraphRole[]).map((role) => {
            const config = ROLE_COLORS[role];
            const isVisible = visibleRoles[role];
            return (
              <button
                key={role}
                type="button"
                onClick={() => setVisibleRoles((prev) => ({ ...prev, [role]: !prev[role] }))}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition cursor-pointer ${
                  isVisible
                    ? 'bg-slate-900 text-slate-200 border-slate-700'
                    : 'bg-slate-950 text-slate-600 border-slate-900 opacity-50'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: config.fill }}
                />
                <span>{config.label}</span>
              </button>
            );
          })}
        </div>

        {/* Edge Types Toggles */}
        <div className="flex items-center gap-2 text-slate-400">
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleEdgeTypes.citation}
              onChange={(e) =>
                setVisibleEdgeTypes((p) => ({ ...p, citation: e.target.checked }))
              }
              className="rounded accent-slate-400 w-3 h-3"
            />
            <span className="text-[10px]">Citas</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleEdgeTypes.semantic_similarity}
              onChange={(e) =>
                setVisibleEdgeTypes((p) => ({ ...p, semantic_similarity: e.target.checked }))
              }
              className="rounded accent-indigo-500 w-3 h-3"
            />
            <span className="text-[10px]">Similitud</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleEdgeTypes.co_authorship}
              onChange={(e) =>
                setVisibleEdgeTypes((p) => ({ ...p, co_authorship: e.target.checked }))
              }
              className="rounded accent-pink-400 w-3 h-3"
            />
            <span className="text-[10px]">Co-autoría</span>
          </label>
        </div>
      </div>

      {/* Main Interactive Canvas */}
      <div className="flex-1 relative overflow-hidden bg-slate-950 cursor-grab active:cursor-grabbing">
        {isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-sm">
            <Sparkles className="w-8 h-8 text-indigo-400 animate-spin mb-2" />
            <p className="text-xs text-slate-400">Calculando topología y centralidades...</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center text-rose-400 text-xs">
            <Info className="w-8 h-8 mb-2 opacity-80" />
            <p>{error}</p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          className="w-full h-full block"
        />

        {/* Hover Tooltip Card */}
        {hoveredNode && !draggedNodeId && (
          <div
            className="fixed z-50 pointer-events-none bg-slate-900/95 border border-slate-800 rounded-xl p-3.5 shadow-2xl max-w-xs text-xs space-y-2 backdrop-blur-md"
            style={{
              left: Math.min(window.innerWidth - 300, mousePos.x + 15),
              top: Math.min(window.innerHeight - 200, mousePos.y + 15),
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-full"
                style={{
                  backgroundColor: `${ROLE_COLORS[hoveredNode.role as GraphRole].fill}25`,
                  color: ROLE_COLORS[hoveredNode.role as GraphRole].stroke,
                  border: `1px solid ${ROLE_COLORS[hoveredNode.role as GraphRole].stroke}40`,
                }}
              >
                {ROLE_COLORS[hoveredNode.role as GraphRole].label}
              </span>
              {hoveredNode.year && (
                <span className="text-[10px] text-slate-400 font-mono">{hoveredNode.year}</span>
              )}
            </div>

            <h4 className="font-semibold text-slate-100 line-clamp-2 leading-snug">
              {hoveredNode.title}
            </h4>

            {hoveredNode.authors?.length > 0 && (
              <p className="text-[11px] text-slate-400 truncate">
                {hoveredNode.authors.join(', ')}
              </p>
            )}

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>Citaciones: {hoveredNode.citations_count || 'N/D'}</span>
              <span>Centralidad: {hoveredNode.centrality}</span>
            </div>
            <p className="text-[10px] text-indigo-400 font-medium pt-1">
              Haz clic para inspeccionar documento en panel izquierdo
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

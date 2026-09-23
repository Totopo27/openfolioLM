import React, { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { createProject } from '../services/api';
import { Project } from '../types';

interface CreateProjectModalProps {
  onClose: () => void;
  onCreated: (project: Project) => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const created = await createProject(name.trim(), desc.trim());
      onCreated(created);
    } catch (err: any) {
      alert(`Error creating project: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
      <div className="bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-2xl w-full max-w-md p-5 space-y-4 font-sans">
        <div className="flex items-center justify-between border-b border-[#E0E0DC] dark:border-[#2A2A2E] pb-3">
          <div className="flex items-center gap-2 text-[#1A1A1A] dark:text-[#EDEDED] font-semibold text-xs font-mono uppercase tracking-wider">
            <FolderPlus className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" />
            <span>Nuevo Proyecto de Investigacion</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 font-mono text-xs">
          <div>
            <label className="block text-[11px] font-bold text-[#666666] dark:text-[#888888] uppercase mb-1">
              Nombre del Proyecto <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="Ej: Analisis Economico 2026, Novela Edipo..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-3 py-2 text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED] font-sans"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[#666666] dark:text-[#888888] uppercase mb-1">
              Descripcion (opcional)
            </label>
            <textarea
              rows={3}
              placeholder="Objetivo o notas sobre los documentos a investigar..."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-3 py-2 text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED] font-sans resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="px-4 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isSubmitting ? 'Creando...' : 'Crear Proyecto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

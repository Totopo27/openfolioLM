import React, { useState } from 'react';
import { Search, ExternalLink, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';

export interface ArchivalDocument {
  id: string;
  title: string;
  authors: string[];
  year: number;
  doi?: string;
  openAccess: boolean;
  status: 'indexed' | 'processing' | 'error';
  chunkCount: number;
  fileSize: string;
  addedAt: string;
}

interface ArchivalIndexProps {
  documents: ArchivalDocument[];
  selectedDocId?: string | null;
  onSelectDocument: (doc: ArchivalDocument) => void;
  onUploadClick: () => void;
}

export const ArchivalIndex: React.FC<ArchivalIndexProps> = ({
  documents,
  selectedDocId,
  onSelectDocument,
  onUploadClick,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOpenAccessOnly, setFilterOpenAccessOnly] = useState(false);
  const [sortField, setSortField] = useState<'year' | 'title' | 'addedAt'>('year');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const filteredDocs = documents
    .filter((doc) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        doc.title.toLowerCase().includes(q) ||
        doc.authors.some((a) => a.toLowerCase().includes(q)) ||
        (doc.doi && doc.doi.toLowerCase().includes(q));
      const matchesOA = filterOpenAccessOnly ? doc.openAccess : true;
      return matchesSearch && matchesOA;
    })
    .sort((a, b) => {
      const modifier = sortDirection === 'asc' ? 1 : -1;
      if (sortField === 'year') return (a.year - b.year) * modifier;
      if (sortField === 'title') return a.title.localeCompare(b.title) * modifier;
      return (new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()) * modifier;
    });

  const toggleSort = (field: 'year' | 'title' | 'addedAt') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  return (
    <section 
      className="w-full h-full flex flex-col bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] font-sans antialiased select-none"
      aria-label="Índice de Fuentes de Investigación"
    >
      {/* Index Header & Controls - Are.na Hairline Grid */}
      <header className="border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214]">
        <div className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-[#666666] dark:text-[#888888] font-bold">
              [INDEX // CATALOG]
            </span>
            <span aria-hidden="true" className="text-[#E0E0DC] dark:text-[#2A2A2E]">|</span>
            <h1 className="text-sm font-semibold tracking-tight font-sans">
              Archival Repository
            </h1>
            <span className="font-mono text-xs text-[#666666] dark:text-[#888888] tabular-nums bg-[#EBEBE8] dark:bg-[#222226] px-1.5 py-0.5 border border-[#E0E0DC] dark:border-[#2A2A2E]">
              {documents.length} ENTRIES
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onUploadClick}
              className="px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A] dark:focus-visible:ring-[#EDEDED]"
            >
              + Add Document
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="grid grid-cols-1 md:grid-cols-12 border-t border-[#E0E0DC] dark:border-[#2A2A2E] text-xs">
          {/* Search Box */}
          <div className="md:col-span-6 flex items-center px-3 py-2 border-b md:border-b-0 md:border-r border-[#E0E0DC] dark:border-[#2A2A2E]">
            <Search className="w-3.5 h-3.5 text-[#666666] dark:text-[#888888] mr-2 shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, author, or DOI…"
              className="w-full bg-transparent border-none focus:outline-none text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] font-mono text-xs"
              aria-label="Buscar por título, autor o DOI"
            />
          </div>

          {/* Toggle Open Access */}
          <div className="md:col-span-3 flex items-center px-3 py-2 border-b md:border-b-0 md:border-r border-[#E0E0DC] dark:border-[#2A2A2E]">
            <label className="flex items-center gap-2 cursor-pointer font-mono text-[11px] text-[#666666] dark:text-[#888888]">
              <input
                type="checkbox"
                checked={filterOpenAccessOnly}
                onChange={(e) => setFilterOpenAccessOnly(e.target.checked)}
                className="rounded-none border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] focus:ring-0 cursor-pointer"
              />
              <span>OPEN ACCESS ONLY</span>
            </label>
          </div>

          {/* Sorting Quick Select */}
          <div className="md:col-span-3 flex items-center justify-between px-3 py-2 font-mono text-[11px] text-[#666666] dark:text-[#888888]">
            <span className="uppercase">SORT BY:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleSort('year')}
                className={`hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] ${
                  sortField === 'year' ? 'font-bold text-[#1A1A1A] dark:text-[#EDEDED] underline' : ''
                }`}
              >
                YEAR
              </button>
              <span>/</span>
              <button
                type="button"
                onClick={() => toggleSort('title')}
                className={`hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] ${
                  sortField === 'title' ? 'font-bold text-[#1A1A1A] dark:text-[#EDEDED] underline' : ''
                }`}
              >
                TITLE
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Catalog Table Container */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse font-sans text-xs" role="table">
          <thead>
            <tr className="border-b border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[11px] text-[#666666] dark:text-[#888888] uppercase bg-[#F2F2F0] dark:bg-[#19191C]">
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-12 text-center">ID</th>
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E]">Title & Authors</th>
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-24">Year</th>
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-56">DOI / Access</th>
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-28 text-right">Chunks</th>
              <th scope="col" className="p-3 font-medium w-28 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E0E0DC] dark:divide-[#2A2A2E]">
            {filteredDocs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center font-mono text-xs text-[#666666] dark:text-[#888888]">
                  [NO MATCHING ENTRIES FOUND IN INDEX]
                </td>
              </tr>
            ) : (
              filteredDocs.map((doc, idx) => {
                const isSelected = doc.id === selectedDocId;
                return (
                  <tr
                    key={doc.id}
                    onClick={() => onSelectDocument(doc)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectDocument(doc);
                      }
                    }}
                    className={`group cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#EBEBE8] dark:bg-[#222226] text-[#1A1A1A] dark:text-[#EDEDED]'
                        : 'hover:bg-[#F2F2F0] dark:hover:bg-[#19191C]'
                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1A1A1A] dark:focus-visible:ring-[#EDEDED]`}
                  >
                    {/* Index Number */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[#666666] dark:text-[#888888] text-center tabular-nums">
                      {String(idx + 1).padStart(2, '0')}
                    </td>

                    {/* Title & Authors */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] min-w-0">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-sm leading-tight text-[#1A1A1A] dark:text-[#EDEDED] group-hover:underline">
                          {doc.title}
                        </span>
                        <span className="text-xs text-[#666666] dark:text-[#888888] truncate font-sans">
                          {doc.authors.join(', ')}
                        </span>
                      </div>
                    </td>

                    {/* Year */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono tabular-nums text-[#1A1A1A] dark:text-[#EDEDED]">
                      {doc.year}
                    </td>

                    {/* DOI / Access Tag */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[11px]">
                      <div className="flex flex-col gap-1">
                        {doc.doi ? (
                          <a
                            href={`https://doi.org/${doc.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[#1A56DB] dark:text-[#60A5FA] hover:underline truncate"
                            aria-label={`Abrir DOI ${doc.doi} en nueva pestaña`}
                          >
                            <span>{doc.doi}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="text-[#999999] dark:text-[#555555]">—</span>
                        )}
                        {doc.openAccess && (
                          <span className="inline-self-start font-mono text-[9px] uppercase px-1 py-0.2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 w-max">
                            OPEN ACCESS
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Chunk Count */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono tabular-nums text-right text-[#666666] dark:text-[#888888]">
                      {doc.chunkCount}&nbsp;chunks
                    </td>

                    {/* Status Badge */}
                    <td className="p-3 text-center font-mono text-[11px]">
                      {doc.status === 'indexed' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>INDEXED</span>
                        </span>
                      )}
                      {doc.status === 'processing' && (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 animate-pulse">
                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>PARSING…</span>
                        </span>
                      )}
                      {doc.status === 'error' && (
                        <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                          <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>ERROR</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <footer className="border-t border-[#E0E0DC] dark:border-[#2A2A2E] p-2.5 px-4 font-mono text-[11px] text-[#666666] dark:text-[#888888] flex items-center justify-between bg-[#F2F2F0] dark:bg-[#19191C]">
        <div>STATUS: GROUNDED ENGINE ACTIVE</div>
        <div className="tabular-nums">TOTAL CHUNKS: {documents.reduce((acc, d) => acc + d.chunkCount, 0)}</div>
      </footer>
    </section>
  );
};

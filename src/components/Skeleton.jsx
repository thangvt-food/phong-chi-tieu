import React from 'react';

function Bar({ w = 'w-full', h = 'h-3', className = '' }) {
  return <div className={`bg-slate-200/80 rounded-full ${h} ${w} ${className}`} />;
}

function CardSkeleton({ rows, rowIcon = true }) {
  return (
    <div className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-sm space-y-3">
      <Bar w="w-32" h="h-3.5" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 py-1.5">
          {rowIcon && <div className="w-8 h-8 rounded-full bg-slate-200/80 shrink-0" />}
          <div className="flex-1 space-y-1.5">
            <Bar w={i % 2 ? 'w-2/5' : 'w-1/2'} h="h-3" />
            <Bar w={i % 2 ? 'w-1/4' : 'w-1/3'} h="h-2.5" />
          </div>
          <Bar w="w-16" h="h-3.5" />
        </div>
      ))}
    </div>
  );
}

export default function LedgerSkeleton() {
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-200/80" />
            <div className="space-y-1.5">
              <Bar w="w-36" h="h-3.5" />
              <Bar w="w-20" h="h-2.5" />
            </div>
          </div>
          <div className="w-24 h-8 rounded-xl bg-slate-200/80" />
        </div>
      </div>
      <main className="max-w-2xl mx-auto px-3 sm:px-4 py-4 space-y-3 animate-pulse">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex gap-3">
          <div className="flex-1 space-y-2 py-1">
            <Bar w="w-1/3" h="h-2.5" />
            <Bar w="w-2/3" h="h-5" />
          </div>
          <div className="w-px bg-slate-100" />
          <div className="flex-1 space-y-2 py-1">
            <Bar w="w-1/3" h="h-2.5" />
            <Bar w="w-1/2" h="h-5" />
          </div>
        </div>
        <CardSkeleton rows={4} />
        <CardSkeleton rows={3} />
      </main>
    </div>
  );
}

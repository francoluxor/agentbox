'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { Topbar } from '@/components/topbar';
import { CreateBoxModal } from '@/app/(dashboard)/boxes/components/create-box-modal';
import { CreateProjectModal } from '@/app/(dashboard)/boxes/components/create-project-modal';
import { HubProvider, useStore } from '@/lib/boxes/store';

function ModalHost() {
  const { modal, closeModal } = useStore();
  if (modal?.type === 'box') return <CreateBoxModal project={modal.project} onClose={closeModal} />;
  if (modal?.type === 'project') return <CreateProjectModal onClose={closeModal} />;
  return null;
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // close the mobile drawer on navigation
  useEffect(() => {
    document.body.classList.remove('nav-open');
  }, [pathname]);

  return (
    <>
      <div className="grid min-h-screen grid-cols-[232px_minmax(0,1fr)] max-md:grid-cols-1">
        <div
          className="pointer-events-none fixed inset-0 z-40 bg-[rgba(20,24,30,.4)] opacity-0 transition-opacity [body.nav-open_&]:pointer-events-auto [body.nav-open_&]:opacity-100"
          onClick={() => document.body.classList.remove('nav-open')}
        />
        <AppSidebar />
        <main className="flex min-w-0 flex-col">
          <Topbar />
          {children}
        </main>
      </div>
      <ModalHost />
    </>
  );
}

export function HubShell({ children }: { children: ReactNode }) {
  return (
    <HubProvider>
      <ShellFrame>{children}</ShellFrame>
    </HubProvider>
  );
}

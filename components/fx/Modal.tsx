'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** rgb triplet for the halo */
  glow?: string;
  shake?: boolean;
  labelledBy?: string;
}

/** Portal-mounted spring modal with a blurred backdrop and coloured halo. */
export default function Modal({
  isOpen,
  onClose,
  children,
  className = 'max-w-lg',
  glow = '46,230,245',
  shake = false,
  labelledBy,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/65 backdrop-blur-md"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={{ opacity: 0, scale: 0.9, y: 30, rotateX: 14 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              rotateX: 0,
              x: shake ? [0, -14, 12, -9, 7, -4, 0] : 0,
            }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 24,
              x: { duration: 0.5, delay: 0.15 },
            }}
            style={{ transformPerspective: 1200 }}
            className={`relative my-auto w-full ${className}`}
          >
            <div
              aria-hidden
              className="absolute -inset-10 -z-10 rounded-[40px] blur-3xl"
              style={{ background: `radial-gradient(closest-side, rgba(${glow},0.25), transparent)` }}
            />
            <div className="relative max-h-[90vh] overflow-y-auto rounded-2xl border border-tint/[0.14] bg-ink-900/95 p-6 shadow-2xl backdrop-blur-2xl">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-10 top-0 h-px"
                style={{ background: `linear-gradient(90deg, transparent, rgba(${glow},0.9), transparent)` }}
              />
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-fg2 transition hover:rotate-90 hover:bg-tint/5 hover:text-fg"
              >
                <X className="h-5 w-5" />
              </button>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface SplitTextProps {
  text: string;
  /** words rendered with the neon gradient */
  accent?: string[];
  className?: string;
  delay?: number;
  as?: 'h1' | 'h2' | 'h3';
}

/** Word-by-word blur/rise reveal (React Bits "Blur Text" / "Split Text"). */
export default function SplitText({ text, accent = [], className = '', delay = 0, as = 'h1' }: SplitTextProps) {
  const Tag = motion[as];
  const words = text.split(' ');
  return (
    <Tag
      className={className}
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: delay } } }}
      aria-label={text}
    >
      {words.map((w, i) => (
        <React.Fragment key={`${w}-${i}`}>
          {i > 0 && ' '}
          <motion.span
            aria-hidden
            className={`inline-block ${accent.includes(w) ? 'text-gradient' : ''}`}
            variants={{
              hidden: { opacity: 0, y: '0.6em', rotateX: -40 },
              show: {
                opacity: 1,
                y: 0,
                rotateX: 0,
                transition: { type: 'spring', damping: 18, stiffness: 140 },
              },
            }}
          >
            {w}
          </motion.span>
        </React.Fragment>
      ))}
    </Tag>
  );
}

import { motion, useReducedMotion } from 'framer-motion';

/* ---------------------------------------------------------------------------
   Shared Framer Motion reveal helpers.
   All entrance motion is one-shot (viewport once) and respects reduced-motion.
--------------------------------------------------------------------------- */

const EASE = [0.22, 1, 0.36, 1];

/** A single element that fades + rises into view once. */
export function Reveal({
  children,
  as = 'div',
  y = 22,
  delay = 0,
  duration = 0.7,
  className,
  ...rest
}) {
  const reduce = useReducedMotion();
  const M = motion[as] || motion.div;
  return (
    <M
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration, ease: EASE, delay }}
      {...rest}
    >
      {children}
    </M>
  );
}

/** Container that staggers its <Item> children as the group enters view. */
export function Stagger({
  children,
  as = 'div',
  gap = 0.08,
  delay = 0.05,
  className,
  ...rest
}) {
  const reduce = useReducedMotion();
  const M = motion[as] || motion.div;
  return (
    <M
      className={className}
      initial={reduce ? false : 'hidden'}
      whileInView={reduce ? undefined : 'show'}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: delay } },
      }}
      {...rest}
    >
      {children}
    </M>
  );
}

const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

/** Child of <Stagger>. */
export function Item({ children, as = 'div', className, ...rest }) {
  const M = motion[as] || motion.div;
  return (
    <M className={className} variants={itemVariants} {...rest}>
      {children}
    </M>
  );
}

export { motion, useReducedMotion };

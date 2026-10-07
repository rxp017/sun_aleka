export default function SkeuomorphicCard({
  children,
  className = '',
  title,
  action,
  tone = 'glass',
  ...props
}) {
  return (
    <section className={`glass-card glass-card--${tone} ${className}`} {...props}>
      {title ? (
        <header className="glass-card__header">
          <div className="glass-card__header-title">
            <span className="glow-dot" />
            <h2>{title}</h2>
          </div>
          {action ? <div className="ml-auto">{action}</div> : null}
        </header>
      ) : null}
      <div className="glass-card__body">
        {children}
      </div>
    </section>
  );
}

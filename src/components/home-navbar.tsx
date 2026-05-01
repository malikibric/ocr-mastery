const NAV_ITEMS = [
  { href: "#workflow-overview", label: "Workflow" },
  { href: "#totals-by-currency", label: "Totals" },
  { href: "#processed-documents", label: "Documents" }
];

export function HomeNavbar() {
  return (
    <header className="site-header">
      <div className="site-header__brand">
        <span className="site-header__eyebrow">Demo</span>
        <span className="site-header__title">
          <em>Mastery</em>
        </span>
      </div>

      <nav aria-label="Homepage sections" className="site-header__nav">
        {NAV_ITEMS.map((item) => (
          <a className="site-header__link" href={item.href} key={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

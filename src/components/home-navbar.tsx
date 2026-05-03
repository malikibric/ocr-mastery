"use client";

import { useState } from "react";
import { logoutAction } from "@/app/auth-actions";

const NAV_ITEMS = [
  { href: "#workflow-overview", label: "Workflow" },
  { href: "#totals-by-currency", label: "Totals" },
  { href: "#processed-documents", label: "Documents" }
];

export function HomeNavbar({ reviewerEmail }: { reviewerEmail: string }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <header className="site-header">
      <div className="site-header__top-row">
        <div className="site-header__brand">
          <div className="site-header__logo" aria-hidden="true">
            <svg
              className="site-header__logo-svg"
              viewBox="0 0 48 48"
              focusable="false"
            >
              <circle className="site-header__logo-outline" cx="24" cy="24" r="22.5" />
              <circle className="site-header__logo-core" cx="24" cy="24" r="18.5" />
              <text className="site-header__logo-mark" x="24" y="29" textAnchor="middle">
                M
              </text>
            </svg>
          </div>
          <div>
            <div className="site-header__eyebrow">Demo</div>
            <div className="site-header__title">
              <em>Mastery</em>
            </div>
          </div>
        </div>
        <button
          aria-controls="homepage-sections-nav"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          className="button-secondary site-header__menu-toggle"
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          Menu
          <span aria-hidden="true" className="site-header__menu-icon">
            <span />
            <span />
            <span />
          </span>
        </button>
      </div>

      <nav
        aria-label="Homepage sections"
        className={`site-header__nav${menuOpen ? " site-header__nav--open" : ""}`}
        id="homepage-sections-nav"
      >
        {NAV_ITEMS.map((item) => (
          <a
            className="site-header__link"
            href={item.href}
            key={item.href}
            onClick={closeMenu}
          >
            {item.label}
          </a>
        ))}
        <span className="site-header__link site-header__reviewer">
          {reviewerEmail}
        </span>
        <form action={logoutAction}>
          <button className="button-secondary" type="submit">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}

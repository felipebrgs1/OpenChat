import { Link } from "@tanstack/react-router";

import { ModeToggle } from "./mode-toggle";

export default function Header() {
  return (
    <header>
      <div className="flex flex-row items-center justify-between px-3 py-2">
        <Link to="/" className="text-lg font-medium tracking-tight">
          Nexo
        </Link>
        <ModeToggle />
      </div>
      <hr />
    </header>
  );
}

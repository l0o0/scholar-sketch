import { getPref, setPref } from "../../utils/prefs";

const DEFAULT_HEIGHT = 321;
const MIN_HEIGHT = 241;

/** Owns native pane geometry; editor state remains in the sidebar session. */
export class WhiteboardSidebarLayout {
  private readonly observer: ResizeObserver;
  private readonly section: HTMLElement | null;
  private readonly container: HTMLElement | null;
  private readonly shell: HTMLElement | null;
  private readonly sidenav: Element | null;
  private compactHeight: number;
  private minScrollHeight = "";
  private minScrollPriority = "";
  focused = false;

  constructor(
    private readonly win: _ZoteroTypes.MainWindow,
    body: HTMLElement,
    private readonly host: HTMLElement,
    private readonly onFocusChange: (focused: boolean) => void,
  ) {
    const height = getPref("whiteboardSidebarHeight");
    this.compactHeight =
      typeof height === "number" &&
      Number.isFinite(height) &&
      height >= MIN_HEIGHT
        ? height
        : DEFAULT_HEIGHT;
    host.style.height = `${this.compactHeight}px`;
    this.section = body.closest<HTMLElement>("item-pane-custom-section");
    this.container = this.section?.parentElement ?? null;
    this.shell = this.container?.parentElement ?? null;
    this.sidenav =
      this.section
        ?.closest("item-pane, context-pane")
        ?.querySelector("item-pane-sidenav") ?? null;
    this.observer = new win.ResizeObserver(() => this.rememberHeight());
    this.observer.observe(host);
  }

  setFocused(focused: boolean) {
    if (this.focused === focused) return;
    if (focused && (!this.section || !this.container)) return;
    this.rememberHeight();
    this.focused = focused;
    if (focused) {
      this.minScrollHeight = this.container!.style.getPropertyValue(
        "--min-scroll-height",
      );
      this.minScrollPriority = this.container!.style.getPropertyPriority(
        "--min-scroll-height",
      );
      this.container!.style.removeProperty("--min-scroll-height");
      this.container!.scrollTop = 0;
      this.container!.classList.add("zmd-sidebar-focus-mode");
      this.shell?.classList.add("zmd-sidebar-focus-shell");
      this.section!.classList.add("zmd-sidebar-focus-section");
      this.sidenav?.addEventListener("click", this.onSidenavClick, true);
    } else {
      this.container?.classList.remove("zmd-sidebar-focus-mode");
      this.shell?.classList.remove("zmd-sidebar-focus-shell");
      this.section?.classList.remove("zmd-sidebar-focus-section");
      if (this.minScrollHeight)
        this.container?.style.setProperty(
          "--min-scroll-height",
          this.minScrollHeight,
          this.minScrollPriority,
        );
      this.sidenav?.removeEventListener("click", this.onSidenavClick, true);
      this.host.style.height = `${this.compactHeight}px`;
    }
    this.onFocusChange(focused);
  }

  private rememberHeight() {
    // Native CSS resizing updates the inline height. Width changes and
    // focus-mode layout must not overwrite the user's compact height.
    const height = Number.parseFloat(this.host.style.height);
    if (
      this.focused ||
      !Number.isFinite(height) ||
      height < MIN_HEIGHT ||
      height === this.compactHeight
    )
      return;
    this.compactHeight = height;
    setPref("whiteboardSidebarHeight", Math.round(height));
  }

  private readonly onSidenavClick = (event: Event) => {
    if (!(event.target instanceof this.win.Element)) return;
    const button = (event.target as Element).closest(".btn[data-pane]");
    if (
      button &&
      button.getAttribute("data-pane") !==
        this.section?.getAttribute("data-pane")
    )
      this.setFocused(false);
  };

  destroy() {
    this.setFocused(false);
    this.observer.disconnect();
  }
}

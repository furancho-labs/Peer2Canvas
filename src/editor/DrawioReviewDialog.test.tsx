import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import DrawioReviewDialog from "./DrawioReviewDialog";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.restoreAllMocks();
});

describe("draw.io compatibility review dialog", () => {
  it("shows losses and preserved content before import confirmation", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DrawioReviewDialog
        review={{
          kind: "import",
          displayName: "architecture.drawio",
          losses: ["One unsupported grid setting will not be imported."],
          preservedFragmentCount: 2,
        }}
        busy={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Review draw.io import",
    });
    // A short description points at the loss count; the list itself is reachable in its region.
    const described = dialog.getAttribute("aria-describedby")!.split(" ");
    expect(described).toEqual(["pc-drawio-description", "pc-drawio-loss-count"]);
    expect(document.getElementById("pc-drawio-loss-count")!.textContent).toBe(
      "1 known compatibility loss",
    );
    expect(within(dialog).getByText(/architecture.drawio/)).toBeTruthy();
    expect(within(dialog).getByText(/2 safe source fragments/)).toBeTruthy();
    expect(within(dialog).getByText(/grid setting/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Import diagram" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Import with losses" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows an empty-loss export review and allows cancellation", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DrawioReviewDialog
        review={{ kind: "export", losses: [], preservedFragmentCount: 0 }}
        busy={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("dialog", {
      name: "Review draw.io export",
    });
    expect(within(dialog).getByText("No known compatibility losses.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("focuses Cancel, keeps Tab inside, closes on Escape and restores focus", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const { unmount } = render(
      <DrawioReviewDialog
        review={{ kind: "export", losses: ["Loss"], preservedFragmentCount: 0 }}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", {
      name: "Export with losses",
    });
    // The scroll region is the first tab stop; Cancel still receives initial focus.
    const region = within(dialog).getByRole("region");
    expect(document.activeElement).toBe(cancel);
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(region);
    fireEvent.keyDown(region, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("blocks every way out while working", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DrawioReviewDialog
        review={{
          kind: "import",
          displayName: "a.drawio",
          losses: [],
          preservedFragmentCount: 0,
        }}
        busy
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(dialog);
    expect(within(dialog).getByText("Working…")).toBeTruthy();
    for (const button of within(dialog).getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    const event = new Event("cancel", { bubbles: false, cancelable: true });
    fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps one list item per reported loss, in order, and user file names untouched", () => {
    render(
      <DrawioReviewDialog
        review={{
          kind: "import",
          displayName: "{count} <b>plan</b>.drawio",
          losses: ["Third thing", "First thing", "Third thing"],
          preservedFragmentCount: 1,
        }}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(["Third thing", "First thing", "Third thing"]);
    expect(screen.getByText(/\{count\} <b>plan<\/b>\.drawio/)).toBeTruthy();
    // One fragment uses the singular phrase.
    expect(screen.getByRole("status").textContent).toMatch(
      /^1 safe source fragment will be retained/,
    );
  });

  it("is fully translated and retranslates when the language changes", () => {
    const review = {
      kind: "import" as const,
      displayName: "arquitectura.drawio",
      losses: ["Pérdida ya traducida por quien llama."],
      preservedFragmentCount: 3,
    };
    const { rerender } = render(
      <I18nProvider locale="es">
        <DrawioReviewDialog review={review} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </I18nProvider>,
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Revisar la importación de draw.io",
    });
    expect(
      within(dialog).getByText(/¿Importar arquitectura\.drawio como un documento nuevo/),
    ).toBeTruthy();
    expect(within(dialog).getByText(/Se conservarán 3 fragmentos seguros/)).toBeTruthy();
    expect(
      within(dialog).getByRole("heading", { name: "1 pérdida de compatibilidad conocida" }),
    ).toBeTruthy();
    expect(within(dialog).getByText("Pérdida ya traducida por quien llama.")).toBeTruthy();
    for (const name of ["Cancelar", "Importar con pérdidas"]) {
      expect(within(dialog).getByRole("button", { name })).toBeTruthy();
    }
    rerender(
      <I18nProvider locale="en">
        <DrawioReviewDialog review={review} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("alertdialog", { name: "Review draw.io import" })).toBe(dialog);
    expect(within(dialog).getByText(/3 safe source fragments/)).toBeTruthy();
  });

  it("separates kept content from losses and makes a long list keyboard-scrollable", () => {
    const losses = Array.from({ length: 40 }, (_, index) => `Loss number ${index}`);
    render(
      <DrawioReviewDialog
        review={{
          kind: "import",
          displayName: "a.drawio",
          losses,
          preservedFragmentCount: 2,
        }}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    // Preserved and loss content are different sections with their own headings.
    expect(
      within(dialog).getByRole("heading", {
        name: "Kept in the file, not shown",
      }),
    ).toBeTruthy();
    const region = within(dialog).getByRole("region", {
      name: "40 known compatibility losses",
    });
    expect(
      within(dialog).getByRole("heading", {
        level: 3,
        name: "40 known compatibility losses",
      }),
    ).toBeTruthy();
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.contains(document.getElementById("pc-drawio-loss-list"))).toBe(true);
    expect(within(region).getAllByRole("listitem")).toHaveLength(40);
    expect(region.closest(".pc-drawio-preserved")).toBeNull();
    // Cancel keeps initial focus; Tab order is region, Cancel, confirm, and the trap still wraps
    // in both directions.
    const confirm = within(dialog).getByRole("button", {
      name: "Import with losses",
    });
    expect(document.activeElement).toBe(cancel);
    // jsdom does not move focus on Tab; the trap only acts at the ends, which are now the
    // region (first stop, in the body) and the confirming action (last stop, in the footer).
    region.focus();
    expect(document.activeElement).toBe(region);
    fireEvent.keyDown(region, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(region);
    const order = [region, cancel, confirm];
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("counts losses with the translator's plural forms and names the lossy action", () => {
    const cases = [
      ["en", 1, "1 known compatibility loss", "Export with losses"],
      ["en", 2, "2 known compatibility losses", "Export with losses"],
      ["es", 1, "1 pérdida de compatibilidad conocida", "Exportar con pérdidas"],
      ["es", 3, "3 pérdidas de compatibilidad conocidas", "Exportar con pérdidas"],
    ] as const;
    for (const [locale, count, badge, action] of cases) {
      const { unmount } = render(
        <I18nProvider locale={locale}>
          <DrawioReviewDialog
            review={{
              kind: "export",
              losses: Array.from({ length: count }, (_, index) => `Loss ${index}`),
              preservedFragmentCount: 0,
            }}
            busy={false}
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          />
        </I18nProvider>,
      );
      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).getByRole("heading", { level: 3, name: badge })).toBeTruthy();
      expect(within(dialog).getByRole("button", { name: action })).toBeTruthy();
      unmount();
    }
  });

  it("keeps the plain actions when there is nothing to lose", () => {
    for (const kind of ["import", "export"] as const) {
      const { unmount } = render(
        <DrawioReviewDialog
          review={{
            kind,
            displayName: "a.drawio",
            losses: [],
            preservedFragmentCount: 2,
          }}
          busy={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", {
          name: kind === "import" ? "Import diagram" : "Save draw.io",
        }),
      ).toBeTruthy();
      expect(screen.queryByText(/\d known compatibility loss/)).toBeNull();
      unmount();
    }
  });

  it("translates the empty-loss export review", () => {
    render(
      <I18nProvider locale="es">
        <DrawioReviewDialog
          review={{ kind: "export", losses: [], preservedFragmentCount: 0 }}
          busy={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );
    const dialog = screen.getByRole("dialog", {
      name: "Revisar la exportación a draw.io",
    });
    expect(within(dialog).getByText("No hay pérdidas de compatibilidad conocidas.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Guardar draw.io" })).toBeTruthy();
  });
});

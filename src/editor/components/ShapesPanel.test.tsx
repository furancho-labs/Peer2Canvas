import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createTranslator } from "../../i18n/translator";
import ShapesPanel from "./ShapesPanel";

afterEach(cleanup);

const { t } = createTranslator("en");

function renderPanel(onAddShape = vi.fn(), disabled = false) {
  render(
    <I18nProvider locale="en">
      <ShapesPanel disabled={disabled} onAddShape={onAddShape} />
    </I18nProvider>,
  );
  return onAddShape;
}

describe("shape catalog rows", () => {
  it("shows a decorative preview, name, category and approved license with attribution beside it", () => {
    renderPanel();
    const row = screen.getAllByRole("listitem")[0]!;
    const button = within(row).getByRole("button");
    const name = within(button).getByText((_text, element) => element?.tagName === "STRONG");
    expect(button.getAttribute("aria-label")).toBe(
      t("editor.shapes.add", { name: name.textContent! }),
    );
    // Preview artwork never contributes to the accessible name.
    for (const image of button.querySelectorAll("img")) {
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("aria-hidden")).toBe("true");
    }
    const small = [...button.querySelectorAll("small")];
    expect(small).toHaveLength(2);
    expect(small[1]!.className).toBe("pc-shape-license");
    expect(small[1]!.textContent).toMatch(/\S/);
    // Source, attribution and rights stay in the disclosure that is a sibling of the button.
    const details = row.querySelector("details")!;
    expect(details.parentElement).toBe(row);
    expect(button.contains(details)).toBe(false);
    expect(
      within(details).getAllByText(small[1]!.textContent!, { exact: false }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps insertion on the existing callback and honors disabled", () => {
    const onAddShape = renderPanel();
    const button = screen.getAllByRole("button", { name: /^Add / })[0]!;
    fireEvent.click(button);
    expect(onAddShape).toHaveBeenCalledOnce();
    cleanup();
    const blocked = renderPanel(vi.fn(), true);
    fireEvent.click(screen.getAllByRole("button", { name: /^Add / })[0]!);
    expect(blocked).not.toHaveBeenCalled();
  });
});

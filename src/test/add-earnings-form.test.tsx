import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "@/routes/index";

const KEY = "dollar-hisab-v2";

const openAmazonForm = () => fireEvent.click(screen.getByRole("button", { name: /Amazon/ }));
const savedTxs = () => JSON.parse(localStorage.getItem(KEY) ?? '{"txs":[]}').txs;

describe("Add Earnings form", () => {
  beforeEach(() => localStorage.clear());

  it("asks for amount, code and survey site, and saves all three with the transaction", () => {
    render(<App />);
    openAmazonForm();

    expect(screen.getByLabelText("Dollar Amount ($)")).toBeInTheDocument();
    expect(screen.getByLabelText("Code / Gift Card Code")).toBeInTheDocument();
    expect(screen.getByLabelText("Survey Site Name")).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "Submit (Pending)" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Dollar Amount ($)"), { target: { value: "5" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Code / Gift Card Code"), { target: { value: "AMZN-9F3K" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Survey Site Name"), { target: { value: "TapResearch" } });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    expect(savedTxs()[0]).toMatchObject({
      method: "amazon",
      usd: 5,
      code: "AMZN-9F3K",
      site: "TapResearch",
      status: "pending",
    });
  });

  it("offers the 10 survey sites in the dropdown", () => {
    render(<App />);
    openAmazonForm();

    const site = screen.getByLabelText("Survey Site Name") as HTMLSelectElement;
    const options = Array.from(site.options).map((o) => o.value).filter(Boolean);

    expect(options).toEqual([
      "TapResearch",
      "Topsurvey",
      "PrimeOpinion",
      "Heycash",
      "Five survey",
      "Heypiggy",
      "Nicesurvey",
      "Surveystreak",
      "Eureka",
      "Other",
    ]);
  });

  it("shows the site and code in recent activity, history and the admin panel", () => {
    render(<App />);
    openAmazonForm();
    fireEvent.change(screen.getByLabelText("Dollar Amount ($)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Code / Gift Card Code"), { target: { value: "APPLE-77Q" } });
    fireEvent.change(screen.getByLabelText("Survey Site Name"), { target: { value: "Heypiggy" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit (Pending)" }));

    expect(screen.getByText(/Heypiggy/)).toBeInTheDocument();
    expect(screen.getByText(/APPLE-77Q/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText(/Heypiggy/)).toBeInTheDocument();
    expect(screen.getByText(/APPLE-77Q/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    const panel = screen.getByText("🛡️ Admin Panel").closest("div")!;
    expect(within(panel).getByText(/APPLE-77Q/)).toBeInTheDocument();
    expect(within(panel).getByText(/Heypiggy/)).toBeInTheDocument();
  });

  it("attaches a proof screenshot and shows View Screenshot in activity, history and the admin panel", async () => {
    render(<App />);
    openAmazonForm();

    expect(screen.getByLabelText("Upload Screenshot / Proof Image")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Dollar Amount ($)"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Code / Gift Card Code"), { target: { value: "PRF-11" } });
    fireEvent.change(screen.getByLabelText("Survey Site Name"), { target: { value: "Eureka" } });
    fireEvent.change(screen.getByLabelText("Upload Screenshot / Proof Image"), {
      target: { files: [new File(["fake-image-bytes"], "proof.png", { type: "image/png" })] },
    });

    // the 3 required fields still gate submit; the screenshot is optional
    expect(screen.getByRole("button", { name: "Submit (Pending)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Submit (Pending)" }));

    await waitFor(() => expect(savedTxs()[0].img).toMatch(/^data:image\//));

    // recent activity
    expect(screen.getByLabelText("View Screenshot")).toBeInTheDocument();

    // history tab
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByLabelText("View Screenshot")).toBeInTheDocument();

    // admin panel
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    const panel = screen.getByText("🛡️ Admin Panel").closest("div")!;
    fireEvent.click(within(panel).getByLabelText("View Screenshot"));
    expect(screen.getByAltText("Payment proof screenshot")).toBeInTheDocument();
  });
});

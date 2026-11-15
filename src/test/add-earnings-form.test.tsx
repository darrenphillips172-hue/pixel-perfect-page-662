import { fireEvent, render, screen } from "@testing-library/react";
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

    fireEvent.change(screen.getByLabelText("Survey Site Name"), { target: { value: "Swagbucks" } });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    expect(savedTxs()[0]).toMatchObject({
      method: "amazon",
      usd: 5,
      code: "AMZN-9F3K",
      site: "Swagbucks",
      status: "pending",
    });
  });

  it("offers the 10 survey sites in the dropdown", () => {
    render(<App />);
    openAmazonForm();

    const site = screen.getByLabelText("Survey Site Name") as HTMLSelectElement;
    const options = Array.from(site.options).map((o) => o.value).filter(Boolean);

    expect(options).toEqual([
      "Swagbucks",
      "Freecash",
      "Prime Opinion",
      "Five Surveys",
      "HeyCash",
      "Qmee",
      "Survey Junkie",
      "InboxDollars",
      "Branded Surveys",
      "Other",
    ]);
  });

  it("shows the site and code in recent activity, history and the admin panel", () => {
    render(<App />);
    openAmazonForm();
    fireEvent.change(screen.getByLabelText("Dollar Amount ($)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Code / Gift Card Code"), { target: { value: "APPLE-77Q" } });
    fireEvent.change(screen.getByLabelText("Survey Site Name"), { target: { value: "Freecash" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit (Pending)" }));

    expect(screen.getByText("Freecash")).toBeInTheDocument();
    expect(screen.getByText(/APPLE-77Q/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("Freecash")).toBeInTheDocument();
    expect(screen.getByText(/APPLE-77Q/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "History" })); // back to home tab is not the nav; open admin instead
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.getByText(/APPLE-77Q/)).toBeInTheDocument();
    expect(screen.getByText("Freecash")).toBeInTheDocument();
  });
});

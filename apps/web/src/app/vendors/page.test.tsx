import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  loadAdminPreviewPriceCatalog: vi.fn(),
  loadPublicPriceCatalog: vi.fn(),
  createPublicClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  noStore: vi.fn(),
  explorerProps: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));
vi.mock("@/lib/price/adminPreviewData", () => ({
  loadAdminPreviewPriceCatalog: mocks.loadAdminPreviewPriceCatalog,
}));
vi.mock("@/lib/price/publicListData", () => ({
  loadPublicPriceCatalog: mocks.loadPublicPriceCatalog,
}));
vi.mock("@/lib/price/buildCatalog", () => ({
  loadPriceCatalogWithBuildFallback: vi.fn((read: () => unknown) => read()),
}));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));
vi.mock("@/app/(app)/AuthenticatedAppShell", () => ({
  default: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/price/PriceExplorer", () => ({
  PriceExplorer: (props: Record<string, unknown>) => {
    mocks.explorerProps = props;
    return null;
  },
}));

import VendorsPage, { metadata } from "./page";

describe("admin vendor preview page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.explorerProps = null;
  });

  it("fails closed before reading pending data for a non-admin preview request", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });
    mocks.loadPublicPriceCatalog.mockResolvedValue({});

    await expect(VendorsPage({
      searchParams: Promise.resolve({ category: "studio", preview: "1" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.loadAdminPreviewPriceCatalog).not.toHaveBeenCalled();
    expect(mocks.loadPublicPriceCatalog).not.toHaveBeenCalled();
  });

  it("uses the service-only pending catalog after admin authorization", async () => {
    const serviceClient = { boundary: "service-only" };
    const catalog = {
      periodLabel: "2026Q3",
      categories: { studio: [], dress: [], makeup: [], hall: [] },
      counts: { studio: 0, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    };
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    mocks.getServiceClient.mockReturnValue(serviceClient);
    mocks.loadAdminPreviewPriceCatalog.mockResolvedValue(catalog);
    mocks.loadPublicPriceCatalog.mockResolvedValue({ public: true });

    const page = await VendorsPage({
      searchParams: Promise.resolve({ category: "hall", preview: "1" }),
    });
    renderToStaticMarkup(page);

    expect(mocks.getServiceClient).toHaveBeenCalledTimes(1);
    expect(mocks.loadAdminPreviewPriceCatalog).toHaveBeenCalledWith(serviceClient);
    expect(mocks.loadPublicPriceCatalog).not.toHaveBeenCalled();
    expect(mocks.explorerProps).toMatchObject({
      catalog,
      category: "hall",
      surface: "app",
      preview: true,
    });
  });

  it("opts only the preview response out of caching and indexing", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    mocks.getServiceClient.mockReturnValue({ boundary: "service-only" });
    mocks.loadAdminPreviewPriceCatalog.mockResolvedValue({
      periodLabel: "2026Q3",
      categories: { studio: [], dress: [], makeup: [], hall: [] },
      counts: { studio: 0, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    });

    await VendorsPage({
      searchParams: Promise.resolve({ category: "studio", preview: "1" }),
    });

    expect(metadata).toMatchObject({ robots: { index: false, follow: false } });
    expect(mocks.noStore).toHaveBeenCalledTimes(1);
  });

  it("keeps the public catalog path out of the preview auth and no-store branch", async () => {
    const publicCatalog = {
      periodLabel: "2026Q2",
      categories: { studio: [], dress: [], makeup: [], hall: [] },
      counts: { studio: 0, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    };
    mocks.createPublicClient.mockReturnValue({ boundary: "public" });
    mocks.loadPublicPriceCatalog.mockResolvedValue(publicCatalog);

    const page = await VendorsPage({
      searchParams: Promise.resolve({ category: "dress" }),
    });
    renderToStaticMarkup(page);

    expect(mocks.verifyAdmin).not.toHaveBeenCalled();
    expect(mocks.noStore).not.toHaveBeenCalled();
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.loadAdminPreviewPriceCatalog).not.toHaveBeenCalled();
    expect(mocks.loadPublicPriceCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.explorerProps).toMatchObject({ preview: false, catalog: publicCatalog });
  });
});

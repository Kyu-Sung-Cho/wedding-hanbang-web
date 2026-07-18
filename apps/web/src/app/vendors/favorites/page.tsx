import { redirect } from "next/navigation";

export default function LegacyVendorFavoritesPage() {
  redirect("/price/wishlist");
}

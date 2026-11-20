/** 다섯 칸이 여는 앱 주소. 전부 `app/` 아래의 정적 화면이라 타입이 정해진 주소(typedRoutes)로 그대로 넘긴다. */
export type HomeServiceMenuHref = "/budget" | "/checklist" | "/wedding-code" | "/quote-check" | "/etiquette";

export type HomeServiceMenuItem = { readonly href: HomeServiceMenuHref; readonly label: string };

export const HOME_SERVICE_MENU_LABEL: string;
export const HOME_SERVICE_MENU: readonly HomeServiceMenuItem[];

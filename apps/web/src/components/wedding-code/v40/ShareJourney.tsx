import { cx } from "./styles";

/** 초대와 응답 화면에 보이는 절차 안내. 실제 완료 여부를 나타내지 않는다. */
export function ShareJourney({ label, steps }: { readonly label: string; readonly steps: readonly string[] }) {
  return (
    <div data-share-journey="" className="border-y border-[var(--hb-hairline)] py-4">
      <p className="text-[13px] font-semibold text-[var(--hb-text-strong)]">{label}</p>
      <ul role="list" className="mt-3 grid grid-cols-3 gap-3 sm:gap-5">
        {steps.map((description, index) => (
          <li key={description} className="min-w-0 border-l border-[var(--hb-hairline)] pl-2.5 sm:pl-3">
            <span className={cx("block break-keep text-[13px] font-medium leading-[1.5] text-[var(--hb-text-body)]", index === steps.length - 1 && "text-[var(--hb-text-strong)]")}>
              {description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

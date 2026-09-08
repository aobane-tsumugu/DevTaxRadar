import type { EquipmentAnnualMethod } from '../../planning/equipmentMethods'

export default function EquipmentAllocationPanel({
  year,
  methods,
  equipment = [],
  taxUnits = [],
}: {
  year: number
  methods: EquipmentAnnualMethod[] | undefined
  equipment?: { id: string; name: string }[]
  taxUnits?: { id: string; name: string }[]
}) {
  const rows = methods?.filter((row) => row.taxYear === year) ?? []
  return (
    <section aria-label="設備の年度別配分根拠">
      <h3>設備の年度別配分根拠</h3>
      {!rows.length && (
        <p>
          この資料には対象年の設備配分条件がありません。設備なしの確認を意味せず、現在の入力から補完しません。
        </p>
      )}
      {rows.map((row) => (
        <div key={row.id}>
          <h4>
            {equipment.find((item) => item.id === row.equipmentId)?.name || '名称未収録'} / {year}年
            / 設備ID {row.equipmentId}
          </h4>
          {!row.allocation ? (
            <p>年度別配分条件は未登録です。当時の設備共通条件と費用明細を参照してください。</p>
          ) : (
            <>
              <p>
                業務割合:{' '}
                {row.allocation.businessUseRatio === null
                  ? '未確認'
                  : row.allocation.businessUseRatio * 100 + '%'}{' '}
                / 根拠: {row.allocation.reason || '未確認'}
              </p>
              {row.allocation.targets !== undefined ? (
                <>
                  {!row.allocation.targets.length ? (
                    <p>制作物対応先なし。業務分は未配分です。</p>
                  ) : (
                    <ul>
                      {row.allocation.targets.map((target) => (
                        <li key={target.taxUnitId}>
                          {taxUnits.find((item) => item.id === target.taxUnitId)?.name ||
                            '名称未収録'}{' '}
                          / 制作物ID {target.taxUnitId} / 業務分の割合:{' '}
                          {target.shareBps === null ? '未確認' : target.shareBps / 100 + '%'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p>
                    未確認の割合を推定しません。未配分額・端数調整後の対応額は、この資料の費用明細を参照してください。
                  </p>
                </>
              ) : (
                <p>
                  制作物対応先:{' '}
                  {row.allocation.taxUnitId === undefined
                    ? '当時の設備共通対応先'
                    : row.allocation.taxUnitId === null
                      ? '未確認・未配分'
                      : `${taxUnits.find((item) => item.id === row.allocation!.taxUnitId)?.name || '名称未収録'} / 制作物ID ${row.allocation.taxUnitId}`}{' '}
                  / 業務分の制作物割合:{' '}
                  {row.allocation.projectAllocationRatio === null
                    ? '未確認'
                    : row.allocation.projectAllocationRatio * 100 + '%'}
                </p>
              )}
            </>
          )}
        </div>
      ))}
    </section>
  )
}

import { useId } from 'react'
import PreviousEquipmentBalancePicker from './PreviousEquipmentBalancePicker'
import EquipmentTargetsEditor from './EquipmentTargetsEditor'
import type { PlanningSnapshot } from '../../planning/types'
import { equipmentMethodSchema, type EquipmentAnnualMethod } from '../../planning/equipmentMethods'
import {
  calculateEquipmentDepreciation,
  equipmentDepreciationInputSchema,
} from '../../core/equipmentDepreciation'

export default function EquipmentMethodsEditor({
  planning,
  onChange,
  allowRead = true,
}: {
  planning: PlanningSnapshot
  onChange: (rows: EquipmentAnnualMethod[]) => void
  allowRead?: boolean
}) {
  const prefix = useId(),
    year = planning.profile.taxYear,
    rows = planning.equipmentMethods ?? []
  const validYear = Number.isInteger(year) && year >= 2007 && year <= 2100
  const replace = (row: EquipmentAnnualMethod) =>
    onChange([
      ...rows.filter((item) => item.taxYear !== year || item.equipmentId !== row.equipmentId),
      row,
    ])
  if (!planning.equipment.length) return null
  return (
    <section className="panel" aria-label="設備の年度別計算条件">
      <h4>{validYear ? `${year}年` : '対象年'}の設備計算条件</h4>
      <p>
        方法と事実、年度別の配分割合と根拠を記録します。設備全体の普通償却額から、その年度の業務分・制作物分を算定します。適用条件の自動検証や税務上の費用の採用ではありません。
      </p>
      {!validYear ? (
        <p>この方法の対象年は2007〜2100年です。</p>
      ) : (
        planning.equipment.map((equipment) => {
          const row = rows.find(
            (item) => item.taxYear === year && item.equipmentId === equipment.id,
          )
          const update = (change: Partial<EquipmentAnnualMethod>) =>
            replace({ ...row!, ...change, recordedAt: new Date().toISOString() })
          let preview = '計算条件は未登録です。購入額を年額の代用にしません。'
          if (row) {
            const parsed = equipmentMethodSchema.safeParse(row)
            if (!parsed.success)
              preview = '計算条件の年数・残高・参照先などを確認してください。入力途中の状態です。'
            else {
              const {
                id: _id,
                recordedAt: _time,
                allocation: _allocation,
                priorReviewId: _priorReviewId,
                ...method
              } = parsed.data
              const input = equipmentDepreciationInputSchema.safeParse({
                ...method,
                acquisitionCostJpy: equipment.acquisitionCostJpy,
                acquiredOn: equipment.acquiredOn,
                businessUseStartedOn: equipment.businessUseStartedOn ?? null,
                convertedFromPrivate: equipment.convertedFromPrivate,
              })
              if (input.success) {
                const result = calculateEquipmentDepreciation(input.data)
                preview =
                  (result.calculation?.explanation ?? '未算定。') + ' ' + result.reasons.join(' / ')
              } else preview = '設備の取得日・業務利用開始日・取得額などを確認してください。'
            }
          }
          return (
            <fieldset key={equipment.id} style={{ minWidth: 0, marginBlock: 16 }}>
              <legend>{equipment.name}</legend>
              {!row ? (
                <button
                  type="button"
                  onClick={() =>
                    replace({
                      id: crypto.randomUUID(),
                      equipmentId: equipment.id,
                      taxYear: year,
                      taxpayer: 'unknown',
                      assetKind: 'unknown',
                      method: 'unknown',
                      methodReason: '',
                      usefulLifeYears: null,
                      useThroughYearEnd: 'unknown',
                      ordinaryTreatment: 'unknown',
                      priorClosing: null,
                      allocation: {
                        taxUnitId: null,
                        businessUseRatio: null,
                        projectAllocationRatio: null,
                        reason: '',
                      },
                      recordedAt: new Date().toISOString(),
                    })
                  }
                >
                  この設備の計算条件を記録
                </button>
              ) : (
                <>
                  {!row.allocation ? (
                    <>
                      <p>年度別の配分条件は未登録です。現在は上の設備共通割合を使用しています。</p>
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            allocation: {
                              taxUnitId: null,
                              businessUseRatio: null,
                              projectAllocationRatio: null,
                              reason: '',
                            },
                          })
                        }
                      >
                        この年度の配分を記録
                      </button>
                    </>
                  ) : (
                    <fieldset style={{ minWidth: 0 }}>
                      <legend>{year}年の配分条件</legend>
                      {row.allocation.targets !== undefined ? (
                        <EquipmentTargetsEditor
                          name={equipment.name}
                          targets={row.allocation.targets}
                          units={planning.taxUnits}
                          onChange={(targets) =>
                            update({ allocation: { ...row.allocation!, targets } })
                          }
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              update({
                                allocation: {
                                  ...row.allocation!,
                                  taxUnitId: null,
                                  projectAllocationRatio: null,
                                  targets: [],
                                },
                              })
                            }
                          >
                            制作物別に配分を入力し直す
                          </button>
                          <p>
                            上の操作では既存の単一対応先と制作物割合を解除します。業務割合と根拠は保持し、制作物ごとの割合を入力するまで業務分は未配分になります。
                          </p>
                          <label style={{ display: 'block', marginBlock: 12 }}>
                            この年度の制作物対応先
                            <select
                              aria-label={`${equipment.name}の年度別制作物対応先`}
                              value={
                                row.allocation.taxUnitId === undefined
                                  ? '__legacy__'
                                  : (row.allocation.taxUnitId ?? '')
                              }
                              onChange={(event) =>
                                update({
                                  allocation: {
                                    ...row.allocation!,
                                    taxUnitId: event.target.value || null,
                                  },
                                })
                              }
                              style={{
                                display: 'block',
                                fontSize: 16,
                                minHeight: 44,
                                width: '100%',
                              }}
                            >
                              {row.allocation.taxUnitId === undefined && (
                                <option value="__legacy__" disabled>
                                  旧設備の共通対応先を使用中
                                </option>
                              )}
                              <option value="">未確認・未配分</option>
                              {planning.taxUnits.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                  {unit.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      <p>
                        空欄は未確認です。0%は確認したゼロとして扱います。根拠が空欄の間は配分しません。
                      </p>
                      {(
                        [
                          ['businessUseRatio', '業務割合'],
                          ['projectAllocationRatio', '業務分のうち制作物への割合'],
                        ] as const
                      )
                        .filter(
                          ([key]) =>
                            row.allocation!.targets === undefined || key === 'businessUseRatio',
                        )
                        .map(([key, label]) => (
                          <label key={key} style={{ display: 'block', marginBlock: 12 }}>
                            {label}（%）
                            <input
                              aria-label={`${equipment.name}の年度別${label}`}
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              value={
                                row.allocation![key] === null ? '' : row.allocation![key]! * 100
                              }
                              onChange={(event) =>
                                update({
                                  allocation: {
                                    ...row.allocation!,
                                    [key]:
                                      event.target.value === ''
                                        ? null
                                        : event.target.valueAsNumber / 100,
                                  },
                                })
                              }
                              style={{
                                display: 'block',
                                fontSize: 16,
                                minHeight: 44,
                                width: '100%',
                              }}
                            />
                          </label>
                        ))}
                      <label style={{ display: 'block' }}>
                        割合の根拠
                        <textarea
                          aria-label={`${equipment.name}の年度別配分根拠`}
                          value={row.allocation.reason}
                          onChange={(event) =>
                            update({
                              allocation: { ...row.allocation!, reason: event.target.value },
                            })
                          }
                        />
                      </label>
                    </fieldset>
                  )}
                  {(
                    [
                      [
                        'taxpayer',
                        '納税者区分',
                        [
                          ['unknown', '未確認'],
                          ['individual', '個人'],
                          ['corporation', '法人（未対応）'],
                        ],
                      ],
                      [
                        'assetKind',
                        '資産の区分',
                        [
                          ['unknown', '未確認'],
                          ['tangible-equipment', '有形設備'],
                          ['intangible', '無形資産（別方法が必要）'],
                        ],
                      ],
                      [
                        'method',
                        '償却方法',
                        [
                          ['unknown', '未確認'],
                          ['straight-line', '普通定額法'],
                          ['other', 'その他（未対応）'],
                        ],
                      ],
                      [
                        'useThroughYearEnd',
                        '対象年末までの利用',
                        [
                          ['unknown', '未確認'],
                          ['confirmed', '年末まで継続利用'],
                          ['ended-or-interrupted', '途中で終了・中断（未対応）'],
                        ],
                      ],
                      [
                        'ordinaryTreatment',
                        '特別な調整',
                        [
                          ['unknown', '未確認'],
                          ['confirmed', '通常償却以外の調整なし'],
                          ['special-or-adjusted', '方法変更・特別償却等あり（未対応）'],
                        ],
                      ],
                    ] as const
                  ).map(([key, label, options]) => (
                    <label key={key} style={{ display: 'block', marginBlock: 12 }}>
                      {label}
                      <select
                        aria-label={`${equipment.name}の${label}`}
                        value={row[key]}
                        style={{ display: 'block', fontSize: 16, minHeight: 44, width: '100%' }}
                        onChange={(event) => update({ [key]: event.target.value })}
                      >
                        {options.map(([value, text]) => (
                          <option key={value} value={value}>
                            {text}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label style={{ display: 'block', marginBlock: 12 }}>
                    この年度に確認した耐用年数
                    <input
                      aria-label={`${equipment.name}の年度別耐用年数`}
                      type="number"
                      min={2}
                      max={50}
                      value={row.usefulLifeYears ?? ''}
                      onChange={(event) =>
                        update({
                          usefulLifeYears:
                            event.target.value === '' ? null : event.target.valueAsNumber,
                        })
                      }
                      style={{ fontSize: 16, minHeight: 44, width: '100%' }}
                    />
                  </label>
                  <label htmlFor={`${prefix}-${equipment.id}-reason`} style={{ display: 'block' }}>
                    方法・年数を選んだ根拠と確認先
                  </label>
                  <textarea
                    id={`${prefix}-${equipment.id}-reason`}
                    aria-label={`${equipment.name}の方法根拠`}
                    value={row.methodReason}
                    maxLength={2000}
                    onChange={(event) => update({ methodReason: event.target.value })}
                    style={{ fontSize: 16, width: '100%', boxSizing: 'border-box' }}
                  />
                  <p>
                    前年末の設備全体の未償却残高。業務分だけの残高や取得額で補いません。年度資料の採用時には、前年資料の設備計算額と照合します。
                  </p>
                  {allowRead && (
                    <PreviousEquipmentBalancePicker
                      key={`${year}:${equipment.id}`}
                      year={year}
                      equipmentId={equipment.id}
                      onUse={(priorClosing, priorReviewId) =>
                        update({ priorClosing, priorReviewId })
                      }
                    />
                  )}
                  {!row.priorClosing ? (
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          priorClosing: { taxYear: year - 1, amountJpy: NaN, reference: '' },
                        })
                      }
                    >
                      前年末残高を記録
                    </button>
                  ) : (
                    <>
                      <p>対象年: {row.priorClosing.taxYear}年末</p>
                      {row.priorReviewId && <p>取り込んだ前年資料ID: {row.priorReviewId}</p>}
                      <input
                        type="number"
                        aria-label={`${equipment.name}の前年末残高`}
                        value={
                          Number.isFinite(row.priorClosing.amountJpy)
                            ? row.priorClosing.amountJpy
                            : ''
                        }
                        onChange={(event) =>
                          update({
                            priorClosing: {
                              ...row.priorClosing!,
                              amountJpy: event.target.valueAsNumber,
                            },
                          })
                        }
                        style={{ fontSize: 16, minHeight: 44 }}
                      />
                      <input
                        aria-label={`${equipment.name}の前年末残高参照先`}
                        value={row.priorClosing.reference}
                        onChange={(event) =>
                          update({
                            priorClosing: { ...row.priorClosing!, reference: event.target.value },
                            priorReviewId: undefined,
                          })
                        }
                        style={{ fontSize: 16, minHeight: 44 }}
                      />
                      <button
                        type="button"
                        onClick={() => update({ priorClosing: null, priorReviewId: undefined })}
                      >
                        前年末残高を未確認に戻す
                      </button>
                    </>
                  )}
                  <p>記録日時: {row.recordedAt}</p>
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
                  >
                    この年度の計算条件を取り除く
                  </button>
                </>
              )}
              <p style={{ overflowWrap: 'anywhere' }}>{preview}</p>
            </fieldset>
          )
        })
      )}
      <p>
        変更は「ここまで保存」などで料金・計画と一緒に保存します。設備本体と他年度の条件は保持します。
      </p>
    </section>
  )
}

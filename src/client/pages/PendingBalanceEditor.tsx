import type { ComponentProps } from 'react'
import ExternalOpeningEditor from './ExternalOpeningEditor'
import PendingBalanceFields from './PendingBalanceFields'

export default function PendingBalanceEditor(props: ComponentProps<typeof PendingBalanceFields>) {
  return (
    <section aria-label="期首の根拠と未判断の記録">
      <ExternalOpeningEditor
        snapshot={props.snapshot}
        planning={props.planning}
        busy={props.busy}
        edit={props.edit}
      />
      <PendingBalanceFields {...props} />
    </section>
  )
}

import type { ComponentProps } from 'react'
import SoftwareAcquisitionForm from './SoftwareAcquisitionForm'
import SoftwareMethodPanel from './SoftwareMethodPanel'

type Props = ComponentProps<typeof SoftwareAcquisitionForm> & {
  onReviewAnnualDecision?: ComponentProps<typeof SoftwareMethodPanel>['onReviewAnnualDecision']
}

/** Acquisition and annual expense selection share the existing balance draft and save path. */
export default function SoftwareAcquisitionPanel({ onReviewAnnualDecision, ...props }: Props) {
  return <>
    <SoftwareAcquisitionForm {...props} />
    <SoftwareMethodPanel
      key={props.datasetId}
      {...props}
      onReviewAnnualDecision={onReviewAnnualDecision}
    />
  </>
}

import type { ComponentProps } from 'react'
import SoftwareAcquisitionForm from './SoftwareAcquisitionForm'
import SoftwareMethodPanel from './SoftwareMethodPanel'

type Props = ComponentProps<typeof SoftwareAcquisitionForm> & {
  onReviewAnnualDecision?: ComponentProps<typeof SoftwareMethodPanel>['onReviewAnnualDecision']
  viewedYear?: string
}

/** Acquisition and annual expense selection share the existing balance draft and save path. */
export default function SoftwareAcquisitionPanel({
  onReviewAnnualDecision,
  viewedYear,
  ...props
}: Props) {
  return (
    <>
      <SoftwareAcquisitionForm {...props} />
      <SoftwareMethodPanel
        key={props.datasetId}
        {...props}
        viewedYear={viewedYear}
        onReviewAnnualDecision={onReviewAnnualDecision}
      />
    </>
  )
}

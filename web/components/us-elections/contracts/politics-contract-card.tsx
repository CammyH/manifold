import clsx from 'clsx'
import Link from 'next/link'
import Router from 'next/router'
import { useEffect, useState } from 'react'

import { AD_WAIT_SECONDS } from 'common/boost'
import { Contract, MultiContract, contractPath } from 'common/contract'
import { ContractCardView } from 'common/events'
import { VisibilityIcon } from 'web/components/contract/contracts-table'
import { useAdTimer } from 'web/hooks/use-ad-timer'
import { useFirebasePublicContract } from 'web/hooks/use-contract-supabase'
import { DEBUG_FEED_CARDS, FeedTimelineItem } from 'web/hooks/use-feed-timeline'
import { useIsVisible } from 'web/hooks/use-is-visible'
import { useSavedContractMetrics } from 'web/hooks/use-saved-contract-metrics'
import { useUser } from 'web/hooks/use-user'
import { track } from 'web/lib/service/analytics'
import { getAdCanPayFunds } from 'web/lib/supabase/ads'
import { getMarketMovementInfo } from 'web/lib/supabase/feed-timeline/feed-market-movement-display'
import { ClickFrame } from 'web/components/widgets/click-frame'
import { Col } from 'web/components/layout/col'
import { SimpleAnswerBars } from 'web/components/answers/answers-panel'

export function PoliticsContractCard(props: {
  contract: Contract
  children?: React.ReactNode
  promotedData?: { adId: string; reward: number }
  /** location of the card, to disambiguate card click events */
  trackingPostfix?: string
  item?: FeedTimelineItem
  className?: string
  /** whether this card is small, like in card grids.*/
  small?: boolean
  hide?: () => void
  showGraph?: boolean
  hideBottomRow?: boolean
  customTitle?: string
  titleSize?: 'lg'
  barColor?: string
}) {
  const {
    promotedData,
    trackingPostfix,
    item,
    className,
    children,
    small,
    hide,
    showGraph,
    hideBottomRow,
    customTitle,
    titleSize,
  } = props
  const user = useUser()

  const contract =
    useFirebasePublicContract(props.contract.visibility, props.contract.id) ??
    props.contract

  const {
    closeTime,
    creatorId,
    creatorName,
    creatorUsername,
    creatorAvatarUrl,
    outcomeType,
    mechanism,
  } = contract

  const isBinaryCpmm = outcomeType === 'BINARY' && mechanism === 'cpmm-1'
  const isClosed = closeTime && closeTime < Date.now()
  const path = contractPath(contract)
  const metrics = useSavedContractMetrics(contract)

  // Note: if we ever make cards taller than viewport, we'll need to pass a lower threshold to the useIsVisible hook

  const [visible, setVisible] = useState(false)
  const { ref } = useIsVisible(
    () => {
      !DEBUG_FEED_CARDS &&
        track('view market card', {
          contractId: contract.id,
          creatorId: contract.creatorId,
          slug: contract.slug,
          feedId: item?.id,
          isPromoted: !!promotedData,
        } as ContractCardView)
      setVisible(true)
    },
    false,
    true,
    () => {
      setVisible(false)
    }
  )

  const adSecondsLeft =
    // eslint-disable-next-line react-hooks/rules-of-hooks
    promotedData && useAdTimer(contract.id, AD_WAIT_SECONDS, visible)
  const [canAdPay, setCanAdPay] = useState(true)
  const adId = promotedData?.adId
  useEffect(() => {
    if (adId) {
      getAdCanPayFunds(adId).then((canPay) => {
        setCanAdPay(canPay)
      })
    }
  }, [adId])

  const { probChange, startTime, ignore } = getMarketMovementInfo(
    contract,
    item
  )

  const trackClick = () =>
    track(('click market card ' + trackingPostfix).trim(), {
      contractId: contract.id,
      creatorId: contract.creatorId,
      slug: contract.slug,
      feedId: item?.id,
      isPromoted: !!promotedData,
    })

  return (
    <ClickFrame
      className={clsx(
        className,
        'relative rounded-xl',
        'cursor-pointer ',
        'fade-in group'
      )}
      onClick={(e) => {
        trackClick()
        Router.push(path)
        e.currentTarget.focus() // focus the div like a button, for style
      }}
      ref={ref}
    >
      <Col className={'w-full flex-col gap-1.5 '}>
        <div
          className={clsx(
            'flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4'
          )}
        >
          {/* Title is link to contract for open in new tab and a11y */}
          <Link
            className={clsx(
              'group-hover:text-primary-700 grow items-start font-semibold transition-colors sm:text-lg ',
              titleSize === 'lg' && ' sm:text-3xl'
            )}
            href={path}
            onClick={trackClick}
          >
            <VisibilityIcon contract={contract} />{' '}
            {customTitle ? customTitle : contract.question}
          </Link>
        </div>
      </Col>

      <div className="w-full overflow-hidden pt-2">
        <SimpleAnswerBars
          contract={contract as MultiContract}
          maxAnswers={4}
          barColor={props.barColor}
        />
      </div>
    </ClickFrame>
  )
}

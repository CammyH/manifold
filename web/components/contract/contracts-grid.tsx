import { Contract } from 'web/lib/firebase/contracts'
import { Col } from '../layout/col'
import { SiteLink } from '../widgets/site-link'
import { BigContractCard, ContractCard, ContractMetricsFooter } from './contract-card'
import { ShowTime } from './contract-details'
import { useCallback } from 'react'
import clsx from 'clsx'
import { LoadingIndicator } from '../widgets/loading-indicator'
import { VisibilityObserver } from '../widgets/visibility-observer'
import Masonry from 'react-masonry-css'

export function ContractsGrid(props: {
  contracts: Contract[] | undefined
  loadMore?: () => void
  showTime?: ShowTime
  onContractClick?: (contract: Contract) => void
  cardUIOptions?: {
    hideQuickBet?: boolean
    hideGroupLink?: boolean
    noLinkAvatar?: boolean
  }
  highlightCards?: string[]
  trackingPostfix?: string
  breakpointColumns?: { [key: string]: number }
  showImageOnTopContract?: boolean
  trackCardViews?: boolean
}) {
  const {
    contracts,
    showTime,
    loadMore,
    onContractClick,
    cardUIOptions,
    highlightCards,
    trackingPostfix,
    showImageOnTopContract,
    trackCardViews,
  } = props
  const { hideQuickBet, hideGroupLink, noLinkAvatar } = cardUIOptions || {}
  const onVisibilityUpdated = useCallback(
    (visible: boolean) => {
      if (visible && loadMore) {
        loadMore()
      }
    },
    [loadMore]
  )

  if (contracts === undefined) {
    return <LoadingIndicator />
  }

  if (contracts.length === 0) {
    return (
      <p className="mx-2 text-gray-500">
        No markets found. Why not{' '}
        <SiteLink href="/create" className="font-bold text-gray-700">
          create one?
        </SiteLink>
      </p>
    )
  }

  const lastIndex =
    !!contracts[0].coverImageUrl &&
    contracts.length >= 4 &&
    contracts.length % 2 === 0
      ? contracts.length - 1
      : undefined

  return (
    <Col className="gap-8">
      <Masonry
        // Show only 1 column on tailwind's md breakpoint (768px)
        breakpointCols={props.breakpointColumns ?? { default: 2, 768: 1 }}
        className="-ml-4 flex w-auto"
        columnClassName="pl-4 bg-clip-padding"
      >
        {contracts.map((contract, index) => (
          <ContractCard
            contract={contract}
            key={contract.id}
            showTime={showTime}
            showImage={
              showImageOnTopContract && (index == 0 || index === lastIndex)
            }
            onClick={
              onContractClick ? () => onContractClick(contract) : undefined
            }
            noLinkAvatar={noLinkAvatar}
            hideQuickBet={hideQuickBet}
            hideGroupLink={hideGroupLink}
            trackingPostfix={trackingPostfix}
            className={clsx(
              'mb-4 transition-all',
              highlightCards?.includes(contract.id) &&
                'bg-gradient-to-b from-indigo-50 via-white to-white outline outline-2 outline-indigo-400'
            )}
            trackCardViews={trackCardViews}
          >
            {contract.mechanism === 'cpmm-1' ? (
              <ContractMetricsFooter contract={contract} />
            ) : undefined}
          </ContractCard>
        ))}
      </Masonry>
      {loadMore && (
        <VisibilityObserver
          onVisibilityUpdated={onVisibilityUpdated}
          className="relative -top-96 h-1"
        />
      )}
    </Col>
  )
}

export function ContractsList(props: {
  contracts: Contract[] | undefined
  loadMore?: () => void
  showTime?: ShowTime
  cardUIOptions?: {
    hideQuickBet?: boolean
    hideGroupLink?: boolean
    noLinkAvatar?: boolean
  }
  highlightCards?: string[]
  trackingPostfix?: string
}) {
  const {
    contracts,
    showTime,
    loadMore,
    cardUIOptions,
    highlightCards,
    trackingPostfix,
  } = props
  const { hideQuickBet, } = cardUIOptions || {}
  const onVisibilityUpdated = useCallback(
    (visible: boolean) => {
      if (visible && loadMore) {
        loadMore()
      }
    },
    [loadMore]
  )

  if (contracts === undefined) {
    return <LoadingIndicator />
  }

  if (contracts.length === 0) {
    return (
      <p className="mx-2 text-gray-500">
        No markets found. Why not{' '}
        <SiteLink href="/create" className="font-bold text-gray-700">
          create one?
        </SiteLink>
      </p>
    )
  }

  return (
    <Col className="max-w-[600px] gap-2">
      {contracts.map((contract) => (
        <BigContractCard
          contract={contract}
          key={contract.id}
          showTime={showTime}
          hideQuickBet={hideQuickBet}
          trackingPostfix={trackingPostfix}
          className={clsx(
            'transition-all',
            highlightCards?.includes(contract.id) &&
              'bg-gradient-to-b from-indigo-50 via-white to-white outline outline-2 outline-indigo-400'
          )}
        >
          {contract.mechanism === 'cpmm-1' && (
            <ContractMetricsFooter contract={contract} />
          )}
        </BigContractCard>
      ))}
      {loadMore && (
        <VisibilityObserver
          onVisibilityUpdated={onVisibilityUpdated}
          className="relative -top-96 h-1"
        />
      )}
    </Col>
  )
}

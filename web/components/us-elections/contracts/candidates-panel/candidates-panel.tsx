import { ArrowRightIcon } from '@heroicons/react/outline'
import clsx from 'clsx'
import { Answer } from 'common/answer'
import { Bet } from 'common/bet'
import { getAnswerProbability } from 'common/calculate'
import { MultiContract, contractPath } from 'common/contract'
import { User } from 'common/user'
import { floatingEqual } from 'common/util/math'
import { sortBy, sumBy } from 'lodash'
import Link from 'next/link'
import { useState } from 'react'
import { Row } from 'web/components/layout/row'
import { useUser } from 'web/hooks/use-user'
import { useUserByIdOrAnswer } from 'web/hooks/use-user-supabase'
import { useChartAnswers } from '../../../charts/contract/choice'
import { Col } from '../../../layout/col'
import { CandidateBar } from './candidate-bar'
import { AnswerPosition } from 'web/components/answers/answer-components'
import { CANDIDATE_DATA } from '../../ candidates/candidate-data'
import { Carousel } from 'web/components/widgets/carousel'

// just the bars
export function CandidatePanel(props: {
  contract: MultiContract
  maxAnswers?: number
}) {
  const { contract, maxAnswers = Infinity } = props
  const { resolutions, outcomeType } = contract

  const shouldAnswersSumToOne =
    'shouldAnswersSumToOne' in contract ? contract.shouldAnswersSumToOne : true
  const user = useUser()
  const answers = contract.answers
    .filter(
      (a) =>
        outcomeType === 'MULTIPLE_CHOICE' || ('number' in a && a.number !== 0)
    )
    .map((a) => ({ ...a, prob: getAnswerProbability(contract, a.id) }))
  const addAnswersMode =
    'addAnswersMode' in contract
      ? contract.addAnswersMode
      : outcomeType === 'FREE_RESPONSE'
      ? 'ANYONE'
      : 'DISABLED'
  const showAvatars =
    addAnswersMode === 'ANYONE' ||
    answers.some((a) => a.userId !== contract.creatorId)

  const sortByProb = true
  const displayedAnswers = sortBy(answers, [
    // Winners for shouldAnswersSumToOne
    (answer) => (resolutions ? -1 * resolutions[answer.id] : answer),
    // Winners for independent binary
    (answer) =>
      'resolution' in answer && answer.resolution
        ? -answer.subsidyPool
        : -Infinity,
    // then by prob or index
    (answer) =>
      !sortByProb && 'index' in answer ? answer.index : -1 * answer.prob,
  ]).slice(0, maxAnswers)

  const moreCount = answers.length - displayedAnswers.length

  const answersArray = useChartAnswers(contract).map((answer) => answer.text)

  // Note: Hide answers if there is just one "Other" answer.
  const showNoAnswers =
    answers.length === 0 || (shouldAnswersSumToOne && answers.length === 1)

  return (
    <Col className="mx-[2px] gap-2">
      {showNoAnswers ? (
        <div className="text-ink-500 pb-4">No answers yet</div>
      ) : (
        <>
          <Carousel labelsParentClassName="gap-2">
            {displayedAnswers.map((answer) => (
              <CandidateAnswer
                user={user}
                key={answer.id}
                answer={answer as Answer}
                contract={contract}
                color={getCandidateColor(answer.text)}
                showAvatars={showAvatars}
              />
            ))}
            {moreCount > 0 && (
              <Link href={contractPath(contract)}>
                <Col
                  className={clsx(
                    'border-ink-200 hover:border-primary-600 border-1 text-ink-800 hover:text-primary-600 bg-canvas-0 sm:text-md h-[68px] w-[11rem] items-center justify-center overflow-hidden rounded-md border-2 text-sm transition-all sm:h-[83px] sm:w-[220px]'
                  )}
                >
                  <Row className="gap-1">
                    See {moreCount} more{' '}
                    <span>
                      <ArrowRightIcon className="h-5 w-5" />
                    </span>
                  </Row>
                </Col>
              </Link>
            )}
          </Carousel>
        </>
      )}
    </Col>
  )
}

function getCandidateColor(name: string) {
  // return 'bg-primary-500'
  if (!CANDIDATE_DATA[name]) return '#9E9FBD'
  if (CANDIDATE_DATA[name]?.party === 'Democrat') return '#adc4e3'
  return '#ecbab5'
}

function CandidateAnswer(props: {
  contract: MultiContract
  answer: Answer
  color: string
  user: User | undefined | null
  onCommentClick?: () => void
  onHover?: (hovering: boolean) => void
  selected?: boolean
  userBets?: Bet[]
  showAvatars?: boolean
  expanded?: boolean
}) {
  const {
    answer,
    contract,
    onCommentClick,
    onHover,
    selected,
    color,
    userBets,
    showAvatars,
    expanded,
    user,
  } = props

  const answerCreator = useUserByIdOrAnswer(answer)
  const prob = getAnswerProbability(contract, answer.id)
  const [editAnswer, setEditAnswer] = useState<Answer>()

  const isCpmm = contract.mechanism === 'cpmm-multi-1'
  const isOther = 'isOther' in answer && answer.isOther

  const { resolution, resolutions } = contract
  const resolvedProb =
    resolution == undefined
      ? undefined
      : resolution === answer.id
      ? 1
      : (resolutions?.[answer.id] ?? 0) / 100

  const sharesSum = sumBy(userBets, (bet) =>
    bet.outcome === 'YES' ? bet.shares : -bet.shares
  )
  const hasBets = userBets && !floatingEqual(sharesSum, 0)
  return (
    <Col className={'w-full'}>
      <CandidateBar
        color={color}
        prob={prob}
        resolvedProb={resolvedProb}
        onHover={onHover}
        className={clsx(
          'cursor-pointer',
          selected && 'ring-primary-600 rounded ring-2'
        )}
        answer={answer}
        selected={selected}
        contract={contract}
      />
      {!resolution && hasBets && isCpmm && user && (
        <AnswerPosition
          contract={contract}
          answer={answer as Answer}
          userBets={userBets}
          className="mt-0.5 self-end sm:mx-3 sm:mt-0"
          user={user}
        />
      )}
    </Col>
  )
}

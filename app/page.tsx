'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Screen = 'sets' | 'questions' | 'learn' | 'add' | 'admin' | 'exam' | 'exam_result'
type StudySet = { id: string; title: string; qualification_name: string | null; description?: string | null; category?: string | null; mock_exam_size: number | null }
type Question = {
  id: string
  study_set_id: string
  question_text: string
  textbook_answer: string | null
  explanation: string | null
  why_correct: string | null
  why_wrong: string | null
  one_point_advice: string | null
  understanding_level: number | null
  choices: string | null
}

const levelLabels: Record<number, string> = { 1: '未理解', 2: '不安', 3: '普通', 4: '理解', 5: '習得' }
const MOCK_EXAM_SIZES = [10, 20, 30, 50, 100]

function validateAuthInput(email: string, password: string) {
  if (!email.trim()) return 'メールアドレスを入力してください。'
  if (!email.includes('@')) return 'メールアドレスの形式を確認してください。'
  if (!password) return 'パスワードを入力してください。'
  if (password.length < 6) return 'パスワードは6文字以上で入力してください。'
  return ''
}

function toJapaneseAuthError(message: string) {
  if (message.includes('Invalid login credentials')) return 'メールアドレスまたはパスワードが違います。'
  if (message.includes('Email not confirmed')) return '確認メールのリンクを開いてからログインしてください。'
  if (message.includes('User already registered')) return 'このメールアドレスは既に登録されています。ログインしてください。'
  if (message.includes('timeout')) return 'ログイン処理がタイムアウトしました。もう一度試してください。'
  return message || '認証処理に失敗しました。'
}

function parseChoices(choices: string | null) {
  if (!choices) return []
  return choices.split('\n').map((choice) => choice.trim()).filter(Boolean)
}

function normalizeText(value: string | null) {
  return (value || '').toLowerCase().replace(/[\s　]/g, '').replace(/[.,、。:：]/g, '')
}

function choiceLabel(value: string) {
  return value.trim().match(/^([A-H])(?:\.|:|：|\s)/i)?.[1].toUpperCase() || ''
}

function choiceBody(value: string) {
  return value.replace(/^([A-H])(?:\.|:|：|\s)\s*/i, '').trim()
}

function answerLabels(answer: string | null) {
  if (!answer) return []
  const labels = answer.toUpperCase().match(/[A-H]/g) || []
  return Array.from(new Set(labels)).sort()
}

function isMultiAnswer(answer: string | null) {
  return answerLabels(answer).length > 1
}

function answerContainsChoiceBody(choice: string, answer: string | null) {
  const answerText = normalizeText(answer)
  const bodyText = normalizeText(choiceBody(choice))
  return Boolean(answerText && bodyText && (answerText.includes(bodyText) || bodyText.includes(answerText)))
}

function isChoiceCorrect(choice: string, answer: string | null) {
  const labels = answerLabels(answer)
  const label = choiceLabel(choice)
  if (labels.length > 0 && label) return labels.includes(label)
  return answerContainsChoiceBody(choice, answer)
}

function isAnswerComplete(selected: string[], answer: string | null) {
  if (selected.length === 0) return false
  const labels = answerLabels(answer)
  if (labels.length > 0) {
    const selectedLabels = selected.map(choiceLabel).filter(Boolean).sort()
    return selectedLabels.length === labels.length && selectedLabels.every((label, index) => label === labels[index])
  }
  return selected.length === 1 && answerContainsChoiceBody(selected[0], answer)
}

async function withTimeout<T>(promise: Promise<T>, milliseconds = 12000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout')), milliseconds)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) return '"' + value.replace(/"/g, '""') + '"'
  return value
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += char
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field); field = ''
    } else if (char === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (char === '\r') {
      // ignore, paired \n handles the line break
    } else {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('sets')
  const [authReady, setAuthReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [studySets, setStudySets] = useState<StudySet[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null)
  const [filterLevel, setFilterLevel] = useState('all')
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string[]>>({})
  const [gradedAnswers, setGradedAnswers] = useState<Record<string, boolean>>({})
  const [selectedExplanation, setSelectedExplanation] = useState<Question | null>(null)
  const [newSetTitle, setNewSetTitle] = useState('')
  const [newSetQuestionCount, setNewSetQuestionCount] = useState('10')
  const [examQuestionIds, setExamQuestionIds] = useState<string[]>([])
  const [examIndex, setExamIndex] = useState(0)
  const [csvBusy, setCsvBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newQuestionChoices, setNewQuestionChoices] = useState('')
  const [newQuestionAnswer, setNewQuestionAnswer] = useState('')
  const [newQuestionExplanation, setNewQuestionExplanation] = useState('')
  const [newQuestionLevel, setNewQuestionLevel] = useState('3')
  const [errorMessage, setErrorMessage] = useState('')
  const [noticeMessage, setNoticeMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editAnswer, setEditAnswer] = useState('')
  const [editExplanation, setEditExplanation] = useState('')
  const [editWhyCorrect, setEditWhyCorrect] = useState('')
  const [editWhyWrong, setEditWhyWrong] = useState('')
  const [editOnePoint, setEditOnePoint] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const selectedSet = studySets.find((set) => set.id === selectedSetId) || null
  const currentSetQuestions = questions.filter((q) => q.study_set_id === selectedSetId)
  const filteredQuestions = useMemo(() => {
    return currentSetQuestions.filter((question) => {
      const level = question.understanding_level || 0
      return filterLevel === 'all' || level === Number(filterLevel)
    })
  }, [currentSetQuestions, filterLevel])

  const currentQuestion = filteredQuestions.find((q) => q.id === currentQuestionId) || filteredQuestions[0] || null
  const currentIndex = currentQuestion ? filteredQuestions.findIndex((q) => q.id === currentQuestion.id) : -1

  function enterStudySet(setId: string) {
    setSelectedSetId(setId)
    setFilterLevel('all')
    setCurrentQuestionId(null)
    setScreen('questions')
  }

  function startLearning(questionId?: string) {
    const target = questionId || filteredQuestions[0]?.id
    if (!target) return
    setCurrentQuestionId(target)
    setScreen('learn')
  }

  function moveQuestion(direction: 1 | -1) {
    const next = filteredQuestions[currentIndex + direction]
    if (next) setCurrentQuestionId(next.id)
  }

  function chooseAnswer(question: Question, choice: string) {
    setSelectedAnswers((current) => {
      const currentSelected = current[question.id] || []
      if (isMultiAnswer(question.textbook_answer)) {
        const next = currentSelected.includes(choice)
          ? currentSelected.filter((item) => item !== choice)
          : [...currentSelected, choice]
        return { ...current, [question.id]: next }
      }
      return { ...current, [question.id]: [choice] }
    })

    setGradedAnswers((current) => ({ ...current, [question.id]: !isMultiAnswer(question.textbook_answer) }))
  }

  function gradeAnswer(questionId: string) {
    setGradedAnswers((current) => ({ ...current, [questionId]: true }))
  }

  function clearAnswer(questionId: string) {
    setSelectedAnswers((current) => ({ ...current, [questionId]: [] }))
    setGradedAnswers((current) => ({ ...current, [questionId]: false }))
  }

  function openExplanation(question: Question) {
    setSelectedExplanation(question)
    setIsEditing(false)
    setEditAnswer(question.textbook_answer || '')
    setEditExplanation(question.explanation || '')
    setEditWhyCorrect(question.why_correct || '')
    setEditWhyWrong(question.why_wrong || '')
    setEditOnePoint(question.one_point_advice || '')
  }

  async function saveExplanationEdits() {
    if (!selectedExplanation) return
    setSavingEdit(true)
    const { error } = await supabase.from('questions').update({
      textbook_answer: editAnswer,
      explanation: editExplanation,
      why_correct: editWhyCorrect,
      why_wrong: editWhyWrong,
      one_point_advice: editOnePoint
    }).eq('id', selectedExplanation.id)
    setSavingEdit(false)
    if (error) return alert('保存に失敗しました。')

    const updated = { ...selectedExplanation, textbook_answer: editAnswer, explanation: editExplanation, why_correct: editWhyCorrect, why_wrong: editWhyWrong, one_point_advice: editOnePoint }
    setSelectedExplanation(updated)
    setQuestions((current) => current.map((q) => q.id === updated.id ? updated : q))
    setIsEditing(false)
  }

  async function refreshSession(markReady = false) {
    try {
      const { data, error } = await withTimeout(supabase.auth.getUser(), 8000)
      if (error) throw error
      setUserId(data.user?.id || null)
    } catch {
      setUserId(null)
    } finally {
      if (markReady) setAuthReady(true)
    }
  }

  async function signUp() {
    setErrorMessage('')
    setNoticeMessage('')
    const validationMessage = validateAuthInput(email, password)
    if (validationMessage) return setErrorMessage(validationMessage)
    setAuthLoading(true)
    try {
      const { data, error } = await withTimeout(supabase.auth.signUp({ email: email.trim(), password }))
      if (error) throw error
      if (data.user && !data.session) return setNoticeMessage('登録しました。確認メールが必要な場合はリンクを開いてください。')
      await refreshSession()
    } catch (error) {
      setErrorMessage(toJapaneseAuthError(error instanceof Error ? error.message : ''))
    } finally {
      setAuthLoading(false)
    }
  }

  async function signIn() {
    setErrorMessage('')
    setNoticeMessage('')
    const validationMessage = validateAuthInput(email, password)
    if (validationMessage) return setErrorMessage(validationMessage)
    setAuthLoading(true)
    try {
      const { error } = await withTimeout(supabase.auth.signInWithPassword({ email: email.trim(), password }))
      if (error) throw error
      await refreshSession()
    } catch (error) {
      setErrorMessage(toJapaneseAuthError(error instanceof Error ? error.message : ''))
    } finally {
      setAuthLoading(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUserId(null)
    setStudySets([])
    setQuestions([])
    setScreen('sets')
  }

  async function fetchStudySets() {
    const { data } = await supabase.from('study_sets').select('*').order('created_at', { ascending: false })
    setStudySets(data || [])
  }

  async function fetchQuestions() {
    const { data } = await supabase.from('questions').select('*').order('created_at', { ascending: false })
    setQuestions(data || [])
  }

  async function createStudySet() {
    if (!newSetTitle.trim() || !userId) return
    await supabase.from('study_sets').insert({ user_id: userId, title: newSetTitle, mock_exam_size: Number(newSetQuestionCount) })
    setNewSetTitle('')
    setNewSetQuestionCount('10')
    fetchStudySets()
  }

  async function deleteStudySet(setId: string) {
    if (!confirm('この学習セットと問題を削除しますか？')) return
    await supabase.from('study_sets').delete().eq('id', setId)
    if (selectedSetId === setId) {
      setSelectedSetId(null)
      setScreen('sets')
    }
    fetchStudySets()
    fetchQuestions()
  }

  async function createQuestion() {
    if (!newQuestionText.trim() || !selectedSetId || !userId) return
    await supabase.from('questions').insert({
      user_id: userId,
      study_set_id: selectedSetId,
      question_text: newQuestionText,
      choices: newQuestionChoices,
      textbook_answer: newQuestionAnswer,
      explanation: newQuestionExplanation,
      understanding_level: Number(newQuestionLevel)
    })
    setNewQuestionText('')
    setNewQuestionChoices('')
    setNewQuestionAnswer('')
    setNewQuestionExplanation('')
    setNewQuestionLevel('3')
    fetchQuestions()
    setScreen('questions')
  }

  async function updateUnderstandingLevel(questionId: string, level: number) {
    await supabase.from('questions').update({ understanding_level: level }).eq('id', questionId)
    fetchQuestions()
  }

  async function deleteQuestion(questionId: string) {
    if (!confirm('この問題を削除しますか？')) return
    await supabase.from('questions').delete().eq('id', questionId)
    fetchQuestions()
  }

  function startMockExam() {
    if (!selectedSet) return
    if (currentSetQuestions.length === 0) return alert('この資格にはまだ問題がありません。先に問題を追加してください。')
    const size = Math.min(selectedSet.mock_exam_size || 10, currentSetQuestions.length)
    const ids = [...currentSetQuestions].sort(() => Math.random() - 0.5).slice(0, size).map((q) => q.id)
    setSelectedAnswers((current) => {
      const next = { ...current }
      ids.forEach((id) => delete next[id])
      return next
    })
    setGradedAnswers((current) => {
      const next = { ...current }
      ids.forEach((id) => delete next[id])
      return next
    })
    setExamQuestionIds(ids)
    setExamIndex(0)
    setScreen('exam')
  }

  function nextExamQuestion() {
    if (examIndex >= examQuestionIds.length - 1) setScreen('exam_result')
    else setExamIndex((index) => index + 1)
  }

  function exportCsv() {
    if (!selectedSet) return
    const header = ['question_text', 'choices', 'textbook_answer', 'explanation', 'why_correct', 'why_wrong', 'one_point_advice', 'understanding_level']
    const rows = currentSetQuestions.map((q) => [
      q.question_text,
      q.choices || '',
      q.textbook_answer || '',
      q.explanation || '',
      q.why_correct || '',
      q.why_wrong || '',
      q.one_point_advice || '',
      String(q.understanding_level ?? '')
    ])
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedSet.title}_questions.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selectedSetId || !userId) return
    setCsvBusy(true)
    try {
      const rows = parseCsv(await file.text())
      const looksLikeHeader = /question|問題文/i.test(rows[0]?.[0] || '')
      const records = (looksLikeHeader ? rows.slice(1) : rows)
        .map((r) => ({
          user_id: userId,
          study_set_id: selectedSetId,
          question_text: (r[0] || '').trim(),
          choices: r[1] || '',
          textbook_answer: r[2] || '',
          explanation: r[3] || '',
          why_correct: r[4] || '',
          why_wrong: r[5] || '',
          one_point_advice: r[6] || '',
          understanding_level: r[7] ? Number(r[7]) || null : null
        }))
        .filter((r) => r.question_text !== '')
      if (records.length === 0) return alert('取り込める行がありませんでした。')
      const { error } = await supabase.from('questions').insert(records)
      if (error) return alert('CSV取り込みに失敗しました。')
      await fetchQuestions()
      alert(`${records.length}件の問題を取り込みました。`)
    } finally {
      setCsvBusy(false)
    }
  }

  useEffect(() => {
    refreshSession(true)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null)
      setAuthReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) return
    fetchStudySets()
    fetchQuestions()
  }, [userId])

  function renderQuestionPractice(question: Question) {
    const level = question.understanding_level || 0
    const choiceLines = parseChoices(question.choices)
    const selected = selectedAnswers[question.id] || []
    const multi = isMultiAnswer(question.textbook_answer)
    const answered = Boolean(gradedAnswers[question.id])
    const correct = answered && isAnswerComplete(selected, question.textbook_answer)

    return (
      <section className="question one-question">
        <div className="row top-row">
          <span className={`badge ${level <= 2 ? 'level-low' : level === 3 ? 'level-mid' : 'level-high'}`}>理解度 {level} {levelLabels[level] || ''}</span>
          <span className="small">{currentIndex + 1} / {filteredQuestions.length}</span>
        </div>
        <div className="question-text">{question.question_text}</div>
        {multi && !answered && <div className="small notice">複数選択です。該当する選択肢をすべて選んでから「回答する」を押してください。</div>}
        <div className="choices">{choiceLines.map((choice) => {
          const selectedThis = selected.includes(choice)
          const correctThis = isChoiceCorrect(choice, question.textbook_answer)
          const className = `choice-button ${selectedThis ? 'selected' : ''} ${answered && correctThis ? 'correct' : ''} ${answered && selectedThis && !correctThis ? 'wrong' : ''}`
          return <button key={choice} className={className} onClick={() => chooseAnswer(question, choice)}>{choice}</button>
        })}</div>
        {multi && selected.length > 0 && !answered && <button className="button" onClick={() => gradeAnswer(question.id)}>回答する</button>}
        {answered && <div className={correct ? 'result correct-text' : 'result wrong-text'}>{correct ? '正解です' : `不正解です。正答: ${question.textbook_answer || '未設定'}`}</div>}
        <div className="learning-actions">
          <button className="button secondary small-button" onClick={() => moveQuestion(-1)} disabled={currentIndex <= 0}>前へ</button>
          {selected.length > 0 && <button className="button secondary small-button" onClick={() => clearAnswer(question.id)}>リセット</button>}
          <button className="button small-button" onClick={() => openExplanation(question)}>解説を見る</button>
          <select className="select compact-select" value={String(level)} onChange={(e) => updateUnderstandingLevel(question.id, Number(e.target.value))}>
            <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
          </select>
          <button className="button secondary small-button" onClick={() => moveQuestion(1)} disabled={currentIndex >= filteredQuestions.length - 1}>次へ</button>
        </div>
      </section>
    )
  }

  function renderExamQuestion() {
    const question = questions.find((q) => q.id === examQuestionIds[examIndex])
    if (!question) return null
    const choiceLines = parseChoices(question.choices)
    const selected = selectedAnswers[question.id] || []
    const multi = isMultiAnswer(question.textbook_answer)
    const isLast = examIndex === examQuestionIds.length - 1

    return (
      <section className="question one-question">
        <div className="row top-row">
          <span className="badge">模擬試験</span>
          <span className="small">{examIndex + 1} / {examQuestionIds.length}</span>
        </div>
        <div className="question-text">{question.question_text}</div>
        {multi && <div className="small notice">複数選択です。該当する選択肢をすべて選んでください。</div>}
        <div className="choices">{choiceLines.map((choice) => {
          const selectedThis = selected.includes(choice)
          return <button key={choice} className={`choice-button ${selectedThis ? 'selected' : ''}`} onClick={() => chooseAnswer(question, choice)}>{choice}</button>
        })}</div>
        <div className="learning-actions">
          <button className="button" onClick={nextExamQuestion} disabled={selected.length === 0}>{isLast ? '結果を見る' : '次の問題へ'}</button>
        </div>
      </section>
    )
  }

  if (!authReady) return <main className="page login-page"><div className="card login-card"><div className="title">MyLearnTool</div><p className="small">セッション確認中...</p></div></main>

  if (!userId) {
    return <main className="page login-page"><div className="card login-card"><div className="title">MyLearnTool</div><div className="stack"><label>メールアドレス<input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" /></label><label>パスワード<input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6文字以上" /></label>{errorMessage && <div className="small error">{errorMessage}</div>}{noticeMessage && <div className="small success">{noticeMessage}</div>}<div className="row"><button className="button" onClick={signIn} disabled={authLoading}>{authLoading ? '処理中...' : 'ログイン'}</button><button className="button secondary" onClick={signUp} disabled={authLoading}>新規登録</button></div></div></div></main>
  }

  return (
    <main className="page">
      <aside className="sidebar">
        <div className="title">MyLearnTool</div>
        <div className="small">学習セット → 問題集 → 1問演習</div>
        <nav className="tabs">
          <button className={screen === 'sets' ? 'tab active' : 'tab'} onClick={() => setScreen('sets')}>学習セット</button>
          {selectedSet && <button className={screen === 'questions' ? 'tab active' : 'tab'} onClick={() => setScreen('questions')}>問題集</button>}
          {selectedSet && filteredQuestions.length > 0 && <button className={screen === 'learn' ? 'tab active' : 'tab'} onClick={() => startLearning(currentQuestion?.id)}>解く</button>}
          {selectedSet && currentSetQuestions.length > 0 && <button className={screen === 'exam' || screen === 'exam_result' ? 'tab active' : 'tab'} onClick={startMockExam}>模擬試験</button>}
          {selectedSet && <button className={screen === 'add' ? 'tab active' : 'tab'} onClick={() => setScreen('add')}>問題追加</button>}
          <button className={screen === 'admin' ? 'tab active' : 'tab'} onClick={() => setScreen('admin')}>管理</button>
        </nav>
        <button className="button secondary logout-button" onClick={signOut}>ログアウト</button>
      </aside>

      <section className="content">
        {screen !== 'sets' && selectedSet && <div className="breadcrumb"><button className="link-button" onClick={() => setScreen('sets')}>学習セット</button><span>/</span><button className="link-button" onClick={() => setScreen('questions')}>{selectedSet.title}</button></div>}

        {screen === 'sets' && <>
          <div className="header"><div><div className="title">資格・試験一覧</div><div className="small">資格ごとに問題を管理し、自分専用の模擬試験を作成します。</div></div></div>
          <div className="card stack">
            <h2>資格を追加</h2>
            <div className="row">
              <input className="input" placeholder="資格名 例: PMP" value={newSetTitle} onChange={(e) => setNewSetTitle(e.target.value)} />
              <select className="select compact-select" value={newSetQuestionCount} onChange={(e) => setNewSetQuestionCount(e.target.value)}>
                {MOCK_EXAM_SIZES.map((size) => <option key={size} value={size}>{size}問</option>)}
              </select>
              <button className="button" onClick={createStudySet}>追加</button>
            </div>
            <p className="small">選択した問題数が模擬試験の出題数になります。問題は追加後に登録してください。</p>
          </div>
          <div className="set-grid">{studySets.map((set) => {
            const count = questions.filter((q) => q.study_set_id === set.id).length
            return <article key={set.id} className="set-card"><div><h2 className="link-button" onClick={() => enterStudySet(set.id)}>{set.title}</h2><p className="small">{count}問・模擬試験{set.mock_exam_size || 10}問</p></div><div className="row"><button className="button" onClick={() => enterStudySet(set.id)}>問題一覧へ</button><button className="button danger small-button" onClick={() => deleteStudySet(set.id)}>削除</button></div></article>
          })}</div>
        </>}

        {screen === 'questions' && selectedSet && <>
          <div className="header">
            <div><div className="title">{selectedSet.title}</div><div className="small">問題一覧。理解度はここから直接変更できます。</div></div>
            <div className="row">
              <button className="button secondary" onClick={() => setScreen('add')}>＋問題を追加</button>
              <button className="button secondary" onClick={exportCsv} disabled={currentSetQuestions.length === 0}>CSVエクスポート</button>
              <button className="button secondary" onClick={() => fileInputRef.current?.click()} disabled={csvBusy}>{csvBusy ? '取込中...' : 'CSVインポート'}</button>
              <button className="button" onClick={startMockExam}>模擬試験を開始</button>
            </div>
          </div>
          <input type="file" accept=".csv,text/csv" ref={fileInputRef} style={{ display: 'none' }} onChange={importCsv} />
          <section className="card filters"><select className="select" value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}><option value="all">全理解度</option><option value="1">理解度1のみ</option><option value="2">理解度2のみ</option><option value="3">理解度3のみ</option><option value="4">理解度4のみ</option><option value="5">理解度5のみ</option></select></section>
          <section className="card table-card">
            <table className="question-table"><thead><tr><th>問題文</th><th>理解度</th><th>操作</th></tr></thead><tbody>{filteredQuestions.map((q) => <tr key={q.id}><td><button className="table-link" onClick={() => startLearning(q.id)}>{q.question_text.slice(0, 110)}</button></td><td><select className="select compact-select" value={String(q.understanding_level || 3)} onChange={(e) => updateUnderstandingLevel(q.id, Number(e.target.value))}>{[1, 2, 3, 4, 5].map((lvl) => <option key={lvl} value={lvl}>{lvl} {levelLabels[lvl]}</option>)}</select></td><td><button className="button small-button" onClick={() => startLearning(q.id)}>解く</button> <button className="button danger small-button" onClick={() => deleteQuestion(q.id)}>削除</button></td></tr>)}</tbody></table>
            {filteredQuestions.length === 0 && <p className="small empty">該当する問題がありません。CSVインポートまたは「＋問題を追加」から登録してください。</p>}
          </section>
        </>}

        {screen === 'learn' && currentQuestion && <>{renderQuestionPractice(currentQuestion)}</>}

        {screen === 'exam' && selectedSet && renderExamQuestion()}

        {screen === 'exam_result' && selectedSet && (() => {
          const examQs = examQuestionIds.map((id) => questions.find((q) => q.id === id)).filter((q): q is Question => Boolean(q))
          const correctCount = examQs.filter((q) => isAnswerComplete(selectedAnswers[q.id] || [], q.textbook_answer)).length
          const total = examQs.length
          const rate = total ? Math.round((correctCount / total) * 100) : 0
          return (
            <section className="card stack">
              <h2>模擬試験結果</h2>
              <p className="title">{correctCount} / {total} 問正解（{rate}%）</p>
              <table className="question-table"><thead><tr><th>問題文</th><th>結果</th><th>理解度</th><th>操作</th></tr></thead><tbody>{examQs.map((q) => {
                const ok = isAnswerComplete(selectedAnswers[q.id] || [], q.textbook_answer)
                return <tr key={q.id}><td>{q.question_text.slice(0, 80)}</td><td className={ok ? 'correct-text' : 'wrong-text'}>{ok ? '正解' : '不正解'}</td><td><select className="select compact-select" value={String(q.understanding_level || 3)} onChange={(e) => updateUnderstandingLevel(q.id, Number(e.target.value))}>{[1, 2, 3, 4, 5].map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}</select></td><td><button className="button small-button" onClick={() => openExplanation(q)}>解説</button></td></tr>
              })}</tbody></table>
              <div className="row">
                <button className="button" onClick={startMockExam}>もう一度挑戦</button>
                <button className="button secondary" onClick={() => setScreen('questions')}>問題一覧に戻る</button>
              </div>
            </section>
          )
        })()}

        {screen === 'add' && selectedSet && <section className="card stack"><h2>問題追加</h2><textarea className="textarea" placeholder="問題文" value={newQuestionText} onChange={(e) => setNewQuestionText(e.target.value)} /><textarea className="textarea" placeholder={'選択肢\nA. ...\nB. ...\nC. ...\nD. ...'} value={newQuestionChoices} onChange={(e) => setNewQuestionChoices(e.target.value)} /><input className="input" placeholder="正答。例: B または スポンサー。複数なら A,C" value={newQuestionAnswer} onChange={(e) => setNewQuestionAnswer(e.target.value)} /><textarea className="textarea" placeholder="解説" value={newQuestionExplanation} onChange={(e) => setNewQuestionExplanation(e.target.value)} /><select className="select" value={newQuestionLevel} onChange={(e) => setNewQuestionLevel(e.target.value)}><option value="1">1 未理解</option><option value="2">2 不安</option><option value="3">3 普通</option><option value="4">4 理解</option><option value="5">5 習得</option></select><button className="button" onClick={createQuestion}>保存</button></section>}

        {screen === 'admin' && <section className="grid"><div className="card"><h2>統計</h2><p>問題数: {questions.length}</p><p>未理解・不安: {questions.filter((q) => (q.understanding_level || 0) <= 2).length}</p><p>学習セット数: {studySets.length}</p></div><div className="card"><h2>今後の管理機能</h2><p>タグ管理、CSV、AI生成、復習モードを追加予定。</p></div></section>}
      </section>

      {selectedExplanation && <div className="modal-overlay" onClick={() => setSelectedExplanation(null)}><div className="modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><h2>解説</h2><div className="row"><button className="button secondary small-button" onClick={() => setIsEditing(!isEditing)}>{isEditing ? '表示に戻る' : '解説を編集'}</button><button className="button secondary small-button" onClick={() => setSelectedExplanation(null)}>閉じる</button></div></div><div className="stack modal-body">{isEditing ? <><label>正答<input className="input" value={editAnswer} onChange={(e) => setEditAnswer(e.target.value)} /></label><label>解説<textarea className="textarea" value={editExplanation} onChange={(e) => setEditExplanation(e.target.value)} /></label><label>なぜ正しいか<textarea className="textarea" value={editWhyCorrect} onChange={(e) => setEditWhyCorrect(e.target.value)} /></label><label>なぜ間違いか<textarea className="textarea" value={editWhyWrong} onChange={(e) => setEditWhyWrong(e.target.value)} /></label><label>ワンポイント<textarea className="textarea" value={editOnePoint} onChange={(e) => setEditOnePoint(e.target.value)} /></label><button className="button" onClick={saveExplanationEdits} disabled={savingEdit}>{savingEdit ? '保存中...' : '保存'}</button></> : <><div><div className="small">教材の正答</div><div>{selectedExplanation.textbook_answer || '未設定'}</div></div><div><div className="small">解説</div><div>{selectedExplanation.explanation || '未設定'}</div></div><div><div className="small">なぜ正しいか</div><div>{selectedExplanation.why_correct || '未設定'}</div></div><div><div className="small">なぜ間違いか</div><div>{selectedExplanation.why_wrong || '未設定'}</div></div><div><div className="small">ワンポイント</div><div>{selectedExplanation.one_point_advice || '未設定'}</div></div></>}</div></div></div>}
    </main>
  )
}

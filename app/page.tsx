'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type View = 'solve' | 'list' | 'add' | 'admin'
type StudySet = { id: string; title: string; qualification_name: string | null }
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

const levelLabels: Record<number, string> = {
  1: '未理解',
  2: '不安',
  3: '普通',
  4: '理解',
  5: '習得'
}

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
  if (message.includes('Password should be')) return 'パスワードは6文字以上で入力してください。'
  if (message.includes('timeout')) return 'ログイン処理がタイムアウトしました。もう一度試してください。'
  return message || '認証処理に失敗しました。'
}

function parseChoices(choices: string | null) {
  if (!choices) return []
  return choices.split('\n').map((choice) => choice.trim()).filter(Boolean)
}

function choiceLabel(value: string) {
  return value.trim().match(/^([A-H])(?:\.|:|：|\s)/i)?.[1].toUpperCase() || ''
}

function answerLabels(answer: string | null) {
  if (!answer) return []
  const labels = answer.toUpperCase().match(/[A-H]/g) || []
  return Array.from(new Set(labels)).sort()
}

function isMultiAnswer(answer: string | null) {
  return answerLabels(answer).length > 1
}

function isAnswerComplete(selected: string[], answer: string | null) {
  const selectedLabels = selected.map(choiceLabel).filter(Boolean).sort()
  const correctLabels = answerLabels(answer)
  return selectedLabels.length === correctLabels.length && selectedLabels.every((label, index) => label === correctLabels[index])
}

function isChoiceCorrect(choice: string, answer: string | null) {
  return answerLabels(answer).includes(choiceLabel(choice))
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

export default function Home() {
  const [view, setView] = useState<View>('solve')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [studySets, setStudySets] = useState<StudySet[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedSetId, setSelectedSetId] = useState('all')
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null)
  const [filterLevel, setFilterLevel] = useState('all')
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string[]>>({})
  const [newSetTitle, setNewSetTitle] = useState('')
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newQuestionChoices, setNewQuestionChoices] = useState('')
  const [newQuestionAnswer, setNewQuestionAnswer] = useState('')
  const [newQuestionExplanation, setNewQuestionExplanation] = useState('')
  const [newQuestionLevel, setNewQuestionLevel] = useState('3')
  const [newQuestionStudySet, setNewQuestionStudySet] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [noticeMessage, setNoticeMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

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
  }

  function clearAnswer(questionId: string) {
    setSelectedAnswers((current) => ({ ...current, [questionId]: [] }))
  }

  async function refreshSession() {
    try {
      const { data, error } = await withTimeout(supabase.auth.getUser(), 8000)
      if (error) throw error
      setUserId(data.user?.id || null)
    } catch {
      setUserId(null)
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
  }

  async function fetchStudySets() {
    const { data } = await supabase.from('study_sets').select('*').order('created_at', { ascending: false })
    setStudySets(data || [])
    if (!newQuestionStudySet && data && data.length > 0) setNewQuestionStudySet(data[0].id)
  }

  async function fetchQuestions() {
    const { data } = await supabase.from('questions').select('*').order('created_at', { ascending: false })
    setQuestions(data || [])
  }

  async function createStudySet() {
    if (!newSetTitle.trim() || !userId) return
    await supabase.from('study_sets').insert({ user_id: userId, title: newSetTitle })
    setNewSetTitle('')
    fetchStudySets()
  }

  async function createQuestion() {
    if (!newQuestionText.trim() || !newQuestionStudySet || !userId) return
    await supabase.from('questions').insert({
      user_id: userId,
      study_set_id: newQuestionStudySet,
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
    setView('solve')
  }

  async function updateUnderstandingLevel(questionId: string, level: number) {
    await supabase.from('questions').update({ understanding_level: level }).eq('id', questionId)
    fetchQuestions()
  }

  async function deleteQuestion(questionId: string) {
    await supabase.from('questions').delete().eq('id', questionId)
    fetchQuestions()
  }

  useEffect(() => {
    refreshSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => refreshSession())
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) return
    fetchStudySets()
    fetchQuestions()
  }, [userId])

  const filteredQuestions = useMemo(() => questions.filter((question) => {
    const matchSet = selectedSetId === 'all' || question.study_set_id === selectedSetId
    const level = question.understanding_level || 0
    const matchLevel = filterLevel === 'all' || (filterLevel === 'low' && level <= 2) || (filterLevel === 'mid' && level <= 3) || (filterLevel === 'high' && level >= 4)
    return matchSet && matchLevel
  }), [questions, selectedSetId, filterLevel])

  const lowCount = questions.filter((q) => (q.understanding_level || 0) <= 2).length
  const answeredCount = Object.values(selectedAnswers).filter((items) => items.length > 0).length

  function renderQuestionCard(question: Question, compact = false) {
    const level = question.understanding_level || 0
    const choiceLines = parseChoices(question.choices)
    const selected = selectedAnswers[question.id] || []
    const answered = selected.length > 0
    const correct = isAnswerComplete(selected, question.textbook_answer)
    const multi = isMultiAnswer(question.textbook_answer)

    return (
      <div key={question.id} className="question">
        <div className="row top-row">
          <span className={`badge ${level <= 2 ? 'level-low' : level === 3 ? 'level-mid' : 'level-high'}`}>理解度 {level} {levelLabels[level] || ''}</span>
          {choiceLines.length > 0 && <span className="badge">{multi ? '複数選択' : '単一選択'}</span>}
        </div>
        <div className="question-text">{compact ? question.question_text.slice(0, 140) : question.question_text}</div>
        {choiceLines.length > 0 && (
          <div className="choices">
            {choiceLines.map((choice) => {
              const selectedThis = selected.includes(choice)
              const correctThis = isChoiceCorrect(choice, question.textbook_answer)
              const className = `choice-button ${selectedThis ? 'selected' : ''} ${answered && correctThis ? 'correct' : ''} ${answered && selectedThis && !correctThis ? 'wrong' : ''}`
              return <button key={choice} className={className} onClick={() => chooseAnswer(question, choice)}>{choice}</button>
            })}
          </div>
        )}
        {answered && <div className={correct ? 'result correct-text' : 'result wrong-text'}>{correct ? '正解です' : `不正解です。正答: ${question.textbook_answer || '未設定'}`}</div>}
        <div className="row actions">
          {answered && <button className="button secondary" onClick={() => clearAnswer(question.id)}>回答リセット</button>}
          <button className="button" onClick={() => setSelectedQuestion(question)}>解説を見る</button>
          <select className="select compact-select" value={String(level)} onChange={(e) => updateUnderstandingLevel(question.id, Number(e.target.value))}>
            <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
          </select>
          {view !== 'solve' && <button className="button danger" onClick={() => deleteQuestion(question.id)}>削除</button>}
        </div>
      </div>
    )
  }

  if (!userId) {
    return (
      <main className="page login-page">
        <div className="card login-card">
          <div className="title">MyLearnTool</div>
          <div className="stack">
            <label>メールアドレス<input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" /></label>
            <label>パスワード<input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6文字以上" /></label>
            {errorMessage && <div className="small error">{errorMessage}</div>}
            {noticeMessage && <div className="small success">{noticeMessage}</div>}
            <div className="row"><button className="button" onClick={signIn} disabled={authLoading}>{authLoading ? '処理中...' : 'ログイン'}</button><button className="button secondary" onClick={signUp} disabled={authLoading}>新規登録</button></div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="header">
        <div><div className="title">MyLearnTool</div><div className="small">PMPなどの選択問題を演習・管理する学習ツール</div></div>
        <button className="button secondary" onClick={signOut}>ログアウト</button>
      </div>

      <nav className="tabs">
        <button className={view === 'solve' ? 'tab active' : 'tab'} onClick={() => setView('solve')}>解く</button>
        <button className={view === 'list' ? 'tab active' : 'tab'} onClick={() => setView('list')}>一覧</button>
        <button className={view === 'add' ? 'tab active' : 'tab'} onClick={() => setView('add')}>追加</button>
        <button className={view === 'admin' ? 'tab active' : 'tab'} onClick={() => setView('admin')}>管理</button>
      </nav>

      <section className="card filters">
        <select className="select" value={selectedSetId} onChange={(e) => setSelectedSetId(e.target.value)}><option value="all">すべての学習セット</option>{studySets.map((set) => <option key={set.id} value={set.id}>{set.title}</option>)}</select>
        <select className="select" value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}><option value="all">全理解度</option><option value="low">理解度1〜2</option><option value="mid">理解度1〜3</option><option value="high">理解度4〜5</option></select>
      </section>

      {view === 'solve' && <section className="stack">{filteredQuestions.length === 0 ? <div className="card empty">問題がありません</div> : filteredQuestions.map((q) => renderQuestionCard(q))}</section>}

      {view === 'list' && <section className="stack">{filteredQuestions.map((q) => renderQuestionCard(q, true))}</section>}

      {view === 'add' && <section className="grid">
        <div className="card stack">
          <h2>学習セット作成</h2>
          <input className="input" placeholder="例: PMP" value={newSetTitle} onChange={(e) => setNewSetTitle(e.target.value)} />
          <button className="button" onClick={createStudySet}>学習セット追加</button>
        </div>
        <div className="card stack">
          <h2>問題追加</h2>
          <select className="select" value={newQuestionStudySet} onChange={(e) => setNewQuestionStudySet(e.target.value)}>{studySets.map((set) => <option key={set.id} value={set.id}>{set.title}</option>)}</select>
          <textarea className="textarea" placeholder="問題文" value={newQuestionText} onChange={(e) => setNewQuestionText(e.target.value)} />
          <textarea className="textarea" placeholder={'選択肢\nA. ...\nB. ...\nC. ...\nD. ...'} value={newQuestionChoices} onChange={(e) => setNewQuestionChoices(e.target.value)} />
          <input className="input" placeholder="正答。複数の場合は A,C のように入力" value={newQuestionAnswer} onChange={(e) => setNewQuestionAnswer(e.target.value)} />
          <textarea className="textarea" placeholder="解説" value={newQuestionExplanation} onChange={(e) => setNewQuestionExplanation(e.target.value)} />
          <select className="select" value={newQuestionLevel} onChange={(e) => setNewQuestionLevel(e.target.value)}><option value="1">1 未理解</option><option value="2">2 不安</option><option value="3">3 普通</option><option value="4">4 理解</option><option value="5">5 習得</option></select>
          <button className="button" onClick={createQuestion}>保存</button>
        </div>
      </section>}

      {view === 'admin' && <section className="grid">
        <div className="card"><h2>統計</h2><p>問題数: {questions.length}</p><p>未理解・不安: {lowCount}</p><p>今回回答済み: {answeredCount}</p><p>学習セット数: {studySets.length}</p></div>
        <div className="card"><h2>次に追加予定</h2><p>問題編集、タグ管理、復習モード、CSV、AI生成をここに追加予定。</p></div>
      </section>}

      {selectedQuestion && (
        <div className="modal-overlay" onClick={() => setSelectedQuestion(null)}><div className="modal" onClick={(e) => e.stopPropagation()}><div className="stack">
          <h2>解説</h2><div>{renderQuestionCard(selectedQuestion)}</div>
          <div><div className="small">解説</div><div>{selectedQuestion.explanation || '未設定'}</div></div>
          <div><div className="small">なぜ正しいか</div><div>{selectedQuestion.why_correct || '未設定'}</div></div>
          <div><div className="small">なぜ間違いか</div><div>{selectedQuestion.why_wrong || '未設定'}</div></div>
          <div><div className="small">ワンポイント</div><div>{selectedQuestion.one_point_advice || '未設定'}</div></div>
          <button className="button secondary" onClick={() => setSelectedQuestion(null)}>閉じる</button>
        </div></div></div>
      )}
    </main>
  )
}

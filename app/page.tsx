'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type StudySet = {
  id: string
  title: string
  qualification_name: string | null
}

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
  if (message.includes('Anonymous sign-ins are disabled')) return 'メールアドレスとパスワードを入力してください。'
  return message
}

function parseChoices(choices: string | null) {
  if (!choices) return []

  return choices
    .split('\n')
    .map((choice) => choice.trim())
    .filter(Boolean)
}

export default function Home() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [studySets, setStudySets] = useState<StudySet[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedSetId, setSelectedSetId] = useState('all')
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null)
  const [filterLevel, setFilterLevel] = useState('all')
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

  async function refreshSession() {
    const { data } = await supabase.auth.getUser()
    setUserId(data.user?.id || null)
  }

  async function signUp() {
    setErrorMessage('')
    setNoticeMessage('')

    const validationMessage = validateAuthInput(email, password)
    if (validationMessage) {
      setErrorMessage(validationMessage)
      return
    }

    setAuthLoading(true)
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
    setAuthLoading(false)

    if (error) {
      setErrorMessage(toJapaneseAuthError(error.message))
      return
    }

    if (data.user && !data.session) {
      setNoticeMessage('登録しました。確認メールが届いている場合は、リンクを開いてからログインしてください。')
      return
    }

    setNoticeMessage('登録しました。')
    refreshSession()
  }

  async function signIn() {
    setErrorMessage('')
    setNoticeMessage('')

    const validationMessage = validateAuthInput(email, password)
    if (validationMessage) {
      setErrorMessage(validationMessage)
      return
    }

    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setAuthLoading(false)

    if (error) {
      setErrorMessage(toJapaneseAuthError(error.message))
      return
    }

    refreshSession()
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

    if (!newQuestionStudySet && data && data.length > 0) {
      setNewQuestionStudySet(data[0].id)
    }
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

  const filteredQuestions = useMemo(() => {
    return questions.filter((question) => {
      const matchSet = selectedSetId === 'all' || question.study_set_id === selectedSetId
      const level = question.understanding_level || 0
      const matchLevel =
        filterLevel === 'all' ||
        (filterLevel === 'low' && level <= 2) ||
        (filterLevel === 'mid' && level <= 3) ||
        (filterLevel === 'high' && level >= 4)

      return matchSet && matchLevel
    })
  }, [questions, selectedSetId, filterLevel])

  if (!userId) {
    return (
      <main className="page">
        <div className="card" style={{ maxWidth: 420, margin: '80px auto' }}>
          <div className="title">MyLearnTool</div>
          <div className="stack">
            <div>
              <div>メールアドレス</div>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" />
            </div>
            <div>
              <div>パスワード</div>
              <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6文字以上" />
            </div>
            {errorMessage && <div className="small" style={{ color: 'red' }}>{errorMessage}</div>}
            {noticeMessage && <div className="small" style={{ color: '#047857' }}>{noticeMessage}</div>}
            <div className="row">
              <button className="button" onClick={signIn} disabled={authLoading}>{authLoading ? '処理中...' : 'ログイン'}</button>
              <button className="button secondary" onClick={signUp} disabled={authLoading}>新規登録</button>
            </div>
            <div className="small">まず新規登録してください。確認メールが届く設定の場合は、メール内のリンクを開いてからログインします。</div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="header">
        <div>
          <div className="title">MyLearnTool</div>
          <div className="small">学習セット・問題・理解度を管理するMVP</div>
        </div>
        <button className="button secondary" onClick={signOut}>ログアウト</button>
      </div>

      <div className="grid">
        <div className="stack">
          <div className="card stack">
            <div style={{ fontWeight: 'bold' }}>学習セット作成</div>
            <input className="input" placeholder="例: PMP" value={newSetTitle} onChange={(e) => setNewSetTitle(e.target.value)} />
            <button className="button" onClick={createStudySet}>学習セット追加</button>
          </div>

          <div className="card stack">
            <div style={{ fontWeight: 'bold' }}>問題登録</div>
            <select className="select" value={newQuestionStudySet} onChange={(e) => setNewQuestionStudySet(e.target.value)}>
              {studySets.map((set) => <option key={set.id} value={set.id}>{set.title}</option>)}
            </select>
            <textarea className="textarea" placeholder="問題文" value={newQuestionText} onChange={(e) => setNewQuestionText(e.target.value)} />
            <textarea className="textarea" placeholder={'選択肢（例）\nA. 選択肢1\nB. 選択肢2\nC. 選択肢3\nD. 選択肢4'} value={newQuestionChoices} onChange={(e) => setNewQuestionChoices(e.target.value)} />
            <input className="input" placeholder="教材の正答（例: B. スポンサー）" value={newQuestionAnswer} onChange={(e) => setNewQuestionAnswer(e.target.value)} />
            <textarea className="textarea" placeholder="解説" value={newQuestionExplanation} onChange={(e) => setNewQuestionExplanation(e.target.value)} />
            <select className="select" value={newQuestionLevel} onChange={(e) => setNewQuestionLevel(e.target.value)}>
              <option value="1">1 - まったく理解していない</option>
              <option value="2">2 - あまり理解していない</option>
              <option value="3">3 - 普通</option>
              <option value="4">4 - だいたい理解している</option>
              <option value="5">5 - 完全に理解している</option>
            </select>
            <button className="button" onClick={createQuestion}>問題を保存</button>
          </div>
        </div>

        <div className="stack">
          <div className="card stack">
            <div className="row">
              <select className="select" value={selectedSetId} onChange={(e) => setSelectedSetId(e.target.value)}>
                <option value="all">すべての学習セット</option>
                {studySets.map((set) => <option key={set.id} value={set.id}>{set.title}</option>)}
              </select>
              <select className="select" value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
                <option value="all">全理解度</option>
                <option value="low">理解度1〜2</option>
                <option value="mid">理解度1〜3</option>
                <option value="high">理解度4〜5</option>
              </select>
            </div>
          </div>

          <div className="stack">
            {filteredQuestions.length === 0 && <div className="card empty">まだ問題が登録されていません</div>}
            {filteredQuestions.map((question) => {
              const level = question.understanding_level || 0
              const levelClass = level <= 2 ? 'level-low' : level === 3 ? 'level-mid' : 'level-high'
              const choiceLines = parseChoices(question.choices)

              return (
                <div key={question.id} className="question">
                  <div className="row" style={{ marginBottom: 10 }}>
                    <div className={`badge ${levelClass}`}>理解度 {level}</div>
                    {choiceLines.length > 0 && <div className="badge">選択問題</div>}
                  </div>
                  <div style={{ marginBottom: 12 }}>{question.question_text.slice(0, 160)}</div>

                  {choiceLines.length > 0 && (
                    <div className="choices compact">
                      {choiceLines.map((choice) => <div key={choice} className="choice">{choice}</div>)}
                    </div>
                  )}

                  <div className="row">
                    <button className="button" onClick={() => setSelectedQuestion(question)}>回答を見る</button>
                    <select className="select" value={String(level)} onChange={(e) => updateUnderstandingLevel(question.id, Number(e.target.value))}>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                    <button className="button danger" onClick={() => deleteQuestion(question.id)}>削除</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {selectedQuestion && (
        <div className="modal-overlay" onClick={() => setSelectedQuestion(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="stack">
              <div>
                <div className="small">問題文</div>
                <div>{selectedQuestion.question_text}</div>
              </div>

              {parseChoices(selectedQuestion.choices).length > 0 && (
                <div>
                  <div className="small">選択肢</div>
                  <div className="choices">
                    {parseChoices(selectedQuestion.choices).map((choice) => <div key={choice} className="choice">{choice}</div>)}
                  </div>
                </div>
              )}

              <div>
                <div className="small">教材の正答</div>
                <div>{selectedQuestion.textbook_answer || '未設定'}</div>
              </div>
              <div>
                <div className="small">解説</div>
                <div>{selectedQuestion.explanation || '未設定'}</div>
              </div>
              <div>
                <div className="small">なぜ正しいか</div>
                <div>{selectedQuestion.why_correct || '未設定'}</div>
              </div>
              <div>
                <div className="small">なぜ間違いか</div>
                <div>{selectedQuestion.why_wrong || '未設定'}</div>
              </div>
              <div>
                <div className="small">ワンポイントアドバイス</div>
                <div>{selectedQuestion.one_point_advice || '未設定'}</div>
              </div>
              <div>
                <div className="small">理解度変更</div>
                <select className="select" value={String(selectedQuestion.understanding_level || 3)} onChange={(e) => {
                  updateUnderstandingLevel(selectedQuestion.id, Number(e.target.value))
                  setSelectedQuestion({ ...selectedQuestion, understanding_level: Number(e.target.value) })
                }}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </div>
              <button className="button secondary" onClick={() => setSelectedQuestion(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

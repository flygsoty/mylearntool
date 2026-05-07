'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Todo = {
  id: string
  title: string
  is_complete: boolean
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')

  async function fetchTodos() {
    const { data } = await supabase
      .from('todos')
      .select('*')
      .order('created_at', { ascending: false })

    setTodos(data || [])
  }

  async function addTodo() {
    if (!title.trim()) return

    await supabase.from('todos').insert({
      title,
      is_complete: false
    })

    setTitle('')
    fetchTodos()
  }

  async function toggleTodo(id: string, current: boolean) {
    await supabase
      .from('todos')
      .update({ is_complete: !current })
      .eq('id', id)

    fetchTodos()
  }

  async function deleteTodo(id: string) {
    await supabase.from('todos').delete().eq('id', id)
    fetchTodos()
  }

  useEffect(() => {
    fetchTodos()
  }, [])

  return (
    <main className="container">
      <h1 className="title">MyLearnTool</h1>

      <div className="row">
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New todo"
        />

        <button onClick={addTodo} className="button">
          Add
        </button>
      </div>

      <div>
        {todos.map((todo) => (
          <div key={todo.id} className="todo">
            <div className="todo-left">
              <input
                type="checkbox"
                checked={todo.is_complete}
                onChange={() => toggleTodo(todo.id, todo.is_complete)}
              />

              <span className={todo.is_complete ? 'completed' : ''}>
                {todo.title}
              </span>
            </div>

            <button
              onClick={() => deleteTodo(todo.id)}
              className="delete"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}

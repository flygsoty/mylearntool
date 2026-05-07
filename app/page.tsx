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
    <main className="min-h-screen p-6 max-w-xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">MyLearnTool</h1>

      <div className="flex gap-2 mb-6">
        <input
          className="border p-2 flex-1 rounded"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New todo"
        />

        <button
          onClick={addTodo}
          className="bg-black text-white px-4 rounded"
        >
          Add
        </button>
      </div>

      <div className="space-y-3">
        {todos.map((todo) => (
          <div
            key={todo.id}
            className="border rounded p-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={todo.is_complete}
                onChange={() => toggleTodo(todo.id, todo.is_complete)}
              />

              <span
                className={todo.is_complete ? 'line-through opacity-50' : ''}
              >
                {todo.title}
              </span>
            </div>

            <button
              onClick={() => deleteTodo(todo.id)}
              className="text-red-500"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}

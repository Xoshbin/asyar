import React, { useState } from "react";

export const GreetingView: React.FC = () => {
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setGreeting(`Hello, ${name}! Welcome to Asyar.`);
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">Greeting Plugin</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name"
          className="px-4 py-2 border rounded"
          autoFocus
        />
        <button
          type="submit"
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Greet
        </button>
      </form>
      {greeting && (
        <div className="mt-4 p-4 bg-gray-100 rounded">{greeting}</div>
      )}
    </div>
  );
};

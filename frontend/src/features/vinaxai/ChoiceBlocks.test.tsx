// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { answerIndex, parseBlockJson, QuestionsBlock, QuizBlock, ReplyActionsContext, toQuiz } from './ChoiceBlocks';
import { Markdown } from './Markdown';

afterEach(cleanup);

const QUIZ = JSON.stringify([
  { question: 'Unit of resistance?', options: ['Volt', 'Ohm', 'Amp'], answer: 'Ohm', explanation: 'R = V / I, measured in ohms.' },
  { question: 'V = ?', options: ['I × R', 'I / R'], answer: 'A', explanation: '' },
]);

describe('block JSON', () => {
  it('forgives trailing commas, unwraps an object holding the list, and rejects junk', () => {
    expect(parseBlockJson('[{"question":"a","options":["x",],},]')).toHaveLength(1);
    expect(parseBlockJson('{"questions":[{"question":"a"}]}')).toEqual([{ question: 'a' }]);
    expect(parseBlockJson('[{"question": "a", "opt')).toBeNull();
  });

  it('finds the right option by text, letter or number', () => {
    expect(answerIndex(['Volt', 'Ohm'], 'ohm')).toBe(1);
    expect(answerIndex(['Volt', 'Ohm'], 'B)')).toBe(1);
    expect(answerIndex(['Volt', 'Ohm'], 0)).toBe(0);
    expect(answerIndex(['Volt', 'Ohm'], 'Tesla')).toBe(-1);
    expect(toQuiz([{ question: 'q', options: ['only one'] }])).toEqual([]);
  });
});

describe('questions block', () => {
  it('one question: a tap sends that option as the next message', () => {
    const answer = vi.fn();
    render(<ReplyActionsContext.Provider value={{ live: false, answer }}><QuestionsBlock text='[{"question":"Which level?","options":["Beginner","Expert"]}]' /></ReplyActionsContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    expect(answer).toHaveBeenCalledWith('Expert');
    expect(screen.getByText('Answers sent')).toBeTruthy();
  });

  it('several questions: picks and typed answers go together, one line each', () => {
    const answer = vi.fn();
    render(<ReplyActionsContext.Provider value={{ live: false, answer }}><QuestionsBlock text='[{"question":"Level?","options":["Beginner","Expert"]},{"question":"Topic?","options":["Circuits","Waves"]}]' /></ReplyActionsContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Beginner' }));
    fireEvent.change(screen.getByLabelText('Your own answer to: Topic?'), { target: { value: 'Magnets' } });
    fireEvent.click(screen.getByRole('button', { name: /Send answers/ }));
    expect(answer).toHaveBeenCalledWith('Level? — Beginner\nTopic? — Magnets');
  });

  it('an older reply\'s questions cannot be answered; broken JSON shows as code once written', () => {
    render(<QuestionsBlock text='[{"question":"Level?","options":["Beginner"]}]' />);
    expect((screen.getByRole('button', { name: 'Beginner' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<QuestionsBlock text="not json" />);
    expect(screen.getByText('not json')).toBeTruthy();
  });
});

describe('quiz block', () => {
  it('plays a question at a time, explains each answer and scores the end', () => {
    render(<QuizBlock text={QUIZ} />);
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Volt/ }));
    expect(screen.getByRole('status').textContent).toContain('Not quite. The answer is B. R = V / I, measured in ohms.');
    fireEvent.click(screen.getByRole('button', { name: /Next question/ }));
    fireEvent.click(screen.getByRole('button', { name: /I × R/ }));
    expect(screen.getByRole('status').textContent).toContain('Correct!');
    fireEvent.click(screen.getByRole('button', { name: /See your score/ }));
    expect(screen.getByRole('group', { name: 'Quiz result' }).textContent).toContain('1/2');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
  });

  it('comes from a ```quiz fence in a reply; while it is written it says so', () => {
    render(<Markdown text={`Try this:\n\`\`\`quiz\n${QUIZ}\n\`\`\``} />);
    expect(screen.getByText('Unit of resistance?')).toBeTruthy();
    cleanup();
    render(<ReplyActionsContext.Provider value={{ live: true }}><Markdown text={'```quiz\n[{"question": "Unit'} /></ReplyActionsContext.Provider>);
    expect(screen.getByRole('status').textContent).toContain('Writing the quiz');
  });
});

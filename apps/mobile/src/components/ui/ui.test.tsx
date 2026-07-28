import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import { Button, Card, Input, Badge, Heading, Body, Muted, Screen } from './index';

// Render primitives against the default theme (no AuthProvider/network needed).
jest.mock('@/theme/ThemeProvider', () => {
  const { defaultTheme } = require('@/theme/tokens');
  return { useTheme: () => defaultTheme };
});

describe('Button', () => {
  it('renders its title and fires onPress', () => {
    const onPress = jest.fn();
    render(<Button title="Save" onPress={onPress} />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(['primary', 'secondary', 'ghost'] as const)('renders %s variant without crashing', (variant) => {
    expect(() => render(<Button title="Go" variant={variant} />)).not.toThrow();
    expect(screen.getByText('Go')).toBeTruthy();
  });

  it('shows a spinner and no title while loading, and does not fire onPress', () => {
    const onPress = jest.fn();
    const { UNSAFE_getByType, queryByText } = render(<Button title="Submit" loading onPress={onPress} />);
    expect(queryByText('Submit')).toBeNull();
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    fireEvent.press(UNSAFE_getByType(ActivityIndicator));
    expect(onPress).not.toHaveBeenCalled(); // disabled while loading
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    render(<Button title="Nope" disabled onPress={onPress} />);
    fireEvent.press(screen.getByText('Nope'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Card', () => {
  it('renders children', () => {
    render(<Card><Body>inside</Body></Card>);
    expect(screen.getByText('inside')).toBeTruthy();
  });
});

describe('Input', () => {
  it('renders label + help and reports typing', () => {
    const onChangeText = jest.fn();
    render(<Input label="Email" help="we never share it" placeholder="you@x.com" onChangeText={onChangeText} />);
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('we never share it')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('you@x.com'), 'a@b.c');
    expect(onChangeText).toHaveBeenCalledWith('a@b.c');
  });

  it('shows error text instead of help when error is set', () => {
    render(<Input label="ZIP" help="5 digits" error="Required" />);
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.queryByText('5 digits')).toBeNull();
  });
});

describe('Badge / Typography', () => {
  it('renders brand and accent badges', () => {
    render(<><Badge>Custom</Badge><Badge variant="accent">24/7</Badge></>);
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText('24/7')).toBeTruthy();
  });

  it('renders the typography scale', () => {
    render(<><Heading>Title</Heading><Body>Copy</Body><Muted>caption</Muted></>);
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('caption')).toBeTruthy();
  });
});

describe('Screen', () => {
  it('renders children in both flow and scroll modes', () => {
    const flow = render(<Screen><Body>flow</Body></Screen>);
    expect(flow.getByText('flow')).toBeTruthy();
    const scroll = render(<Screen scroll><Body>scroll</Body></Screen>);
    expect(scroll.getByText('scroll')).toBeTruthy();
  });
});

interface PathBarProps {
  path: string;
}

export function PathBar({ path }: PathBarProps) {
  return (
    <div className="bg-gray-100 dark:bg-gray-800 px-3 py-2 border-b border-gray-300 dark:border-gray-700 text-sm font-mono text-gray-900 dark:text-gray-100 truncate">
      {path || "/"}
    </div>
  );
}

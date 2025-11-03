import React from 'react';
import { Wrench, Clock } from 'lucide-react';

const MaintenancePage: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-orange-50 to-white text-gray-800 p-4">
      <div className="max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <div className="relative">
            <Wrench className="w-24 h-24 text-orange-500 animate-pulse" />
            <Clock className="w-12 h-12 text-orange-400 absolute -bottom-2 -right-2" />
          </div>
        </div>
        
        <h1 className="text-4xl font-bold mb-4 text-gray-900">Under Maintenance</h1>
        
        <p className="text-lg mb-6 text-gray-700 leading-relaxed">
          We're performing essential upgrades to improve Dex.
        </p>
        
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-orange-800">
            <strong>What we're fixing:</strong>
          </p>
          <ul className="text-sm text-orange-700 mt-2 text-left list-disc list-inside space-y-1">
            <li>Contract reserve synchronization</li>
            <li>Swap calculation accuracy</li>
            <li>Pool balance tracking</li>
          </ul>
        </div>
        
        <p className="text-sm text-gray-600 mb-4">
          We appreciate your patience and will be back online shortly.
        </p>
        
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <Clock className="w-4 h-4" />
          <span>Estimated completion: Soon</span>
        </div>
      </div>
    </div>
  );
};

export default MaintenancePage;

